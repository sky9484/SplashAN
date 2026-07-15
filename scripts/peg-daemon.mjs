#!/usr/bin/env node
/**
 * peg-daemon — operator daemon that pushes fresh Pyth-derived USDC/USDT
 * deviations to the on-chain PegState every 30 seconds.
 *
 * Loop:
 *   1. GET http://127.0.0.1:3004/api/quotes/peg-status  (reuses pythAdapter)
 *   2. Compute usdc_dev_ppm / usdt_dev_ppm from returned prices
 *   3. Build PTB: peg_monitor::update_peg(PegState, AdminCap, dev, dev, Clock)
 *   4. Sign with SUI_SPONSOR_PRIVATE_KEY, execute on testnet
 *   5. Sleep 30s
 *
 * Without this, PegState becomes stale (>60s) and every settle_payment /
 * settle_batch aborts with E_PEG_STALE.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const PACKAGE_ID    = process.env.SPLASH_PACKAGE_ID
const PEG_STATE_ID  = process.env.SPLASH_PEG_STATE_ID
const ADMIN_CAP_ID  = process.env.SPLASH_ADMIN_CAP_ID
const PRIVATE_KEY   = process.env.SUI_SPONSOR_PRIVATE_KEY
const RPC_URL       = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443'
const PEG_API_URL   = process.env.PEG_API_URL || 'http://127.0.0.1:3004/api/quotes/peg-status'
const INTERVAL_MS   = Number(process.env.PEG_INTERVAL_MS ?? 30_000)

for (const [k, v] of Object.entries({ PACKAGE_ID, PEG_STATE_ID, ADMIN_CAP_ID, PRIVATE_KEY })) {
  if (!v) {
    console.error(`[peg-daemon] FATAL: ${k} is not set`)
    process.exit(1)
  }
}

const client = new SuiGrpcClient({ network: process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet', baseUrl: RPC_URL })
const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY)
const keypair = Ed25519Keypair.fromSecretKey(secretKey)
const ADDR = keypair.getPublicKey().toSuiAddress()

console.log(`[peg-daemon] starting`)
console.log(`  package:   ${PACKAGE_ID}`)
console.log(`  peg state: ${PEG_STATE_ID}`)
console.log(`  admin cap: ${ADMIN_CAP_ID}`)
console.log(`  sender:    ${ADDR}`)
console.log(`  rpc:       ${RPC_URL}`)
console.log(`  interval:  ${INTERVAL_MS}ms`)

let consecutiveFailures = 0

async function tick() {
  try {
    // 1. Read fresh prices via the existing /api/quotes/peg-status endpoint
    const resp = await fetch(PEG_API_URL)
    if (!resp.ok) throw new Error(`peg-status API ${resp.status}`)
    const data = await resp.json()
    const usdcPrice = Number(data.usdcUsd?.price ?? 1)
    const usdtPrice = Number(data.usdtUsd?.price ?? 1)
    const source = data.usdcUsd?.source ?? 'unknown'

    // 2. ppm deviation from $1
    const usdcDevPpm = Math.max(0, Math.round(Math.abs(usdcPrice - 1.0) * 1_000_000))
    const usdtDevPpm = Math.max(0, Math.round(Math.abs(usdtPrice - 1.0) * 1_000_000))

    // 3. PTB
    const tx = new Transaction()
    tx.moveCall({
      target: `${PACKAGE_ID}::peg_monitor::update_peg`,
      arguments: [
        tx.object(PEG_STATE_ID),
        tx.object(ADMIN_CAP_ID),
        tx.pure.u64(usdcDevPpm),
        tx.pure.u64(usdtDevPpm),
        tx.object('0x6'),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      include: { effects: true },
    })

    const executed = result.Transaction ?? result.FailedTransaction
    if (result.$kind !== 'Transaction' || !executed.status.success) {
      throw new Error(`tx failed: ${JSON.stringify(executed.status.error)}`)
    }

    consecutiveFailures = 0
    console.log(
      `[peg-daemon] ok  src=${source}  usdc=${usdcPrice.toFixed(6)} (${usdcDevPpm}ppm)  ` +
      `usdt=${usdtPrice.toFixed(6)} (${usdtDevPpm}ppm)  digest=${executed.digest}`,
    )
  } catch (e) {
    consecutiveFailures++
    console.error(`[peg-daemon] fail #${consecutiveFailures}: ${e?.message ?? e}`)
    if (consecutiveFailures >= 10) {
      console.error('[peg-daemon] 10 consecutive failures — exiting; systemd will restart')
      process.exit(1)
    }
  }
}

// Run immediately + every INTERVAL_MS thereafter
await tick()
const handle = setInterval(tick, INTERVAL_MS)

function shutdown(sig) {
  console.log(`[peg-daemon] got ${sig}, shutting down`)
  clearInterval(handle)
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
