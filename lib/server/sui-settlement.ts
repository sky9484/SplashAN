import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Transaction } from '@mysten/sui/transactions';

import {
  CONTRACT_MAX_FEE_BPS,
  FALLBACK_FEE_BPS,
  getCorridorFeeBps,
} from '@/lib/fx/corridors';
import { getContractConfig, type ContractConfigField } from '@/lib/server/contract-config';
import { suiClient } from '@/lib/sui';

const execFileAsync = promisify(execFile);

// ── Settlement mode / CLI availability ──────────────────────────────────────
// Production prefers the server-side SDK signer because serverless instances do
// not have persistent Sui CLI keystores. A fully configured CLI is retained as
// a local/operator fallback. Simulation must be explicit, or auto + mock APIs.
type SettlementExecution = 'sdk' | 'cli' | 'simulate';
type CliReadiness = { ready: true; address: string } | { ready: false; reason: string };

let cachedOperatorKeypair: Ed25519Keypair | Secp256k1Keypair | null | undefined;
let cachedCliReadiness: CliReadiness | null = null;

function settlementMode(): 'auto' | 'live' | 'simulate' {
  const mode = (process.env.SUI_SETTLEMENT_MODE ?? 'auto').trim().toLowerCase();
  if (mode === 'auto' || mode === 'live' || mode === 'simulate') return mode;
  throw new Error(`Invalid SUI_SETTLEMENT_MODE "${mode}". Use auto, live, or simulate.`);
}

// Batch-only settlement override. `settle_batch` requires live DeepBook order-book
// depth (peg_monitor::assert_deepbook_liquidity), which testnet pools rarely have,
// so a real batch can abort mid-demo. Setting SUI_BATCH_SETTLEMENT_MODE=simulate
// keeps batch on a labelled SIM_ receipt while single transfers, treasury, and the
// composed proof flow still settle for real. Returns null → fall through to the
// global mode.
function batchExecutionOverride(): SettlementExecution | null {
  const mode = (process.env.SUI_BATCH_SETTLEMENT_MODE ?? '').trim().toLowerCase();
  return mode === 'simulate' ? 'simulate' : null;
}

function configuredOperatorAddress(): string {
  return (getContractConfig().operatorAddress ?? '').trim();
}

export function getOperatorKeypair(): Ed25519Keypair | Secp256k1Keypair | null {
  if (cachedOperatorKeypair !== undefined) return cachedOperatorKeypair;

  const encoded = (
    process.env.OPERATOR_SUI_PRIVATE_KEY ??
    process.env.SUI_SPONSOR_PRIVATE_KEY ??
    ''
  ).trim();

  if (!encoded) {
    cachedOperatorKeypair = null;
    return null;
  }

  try {
    const parsed = decodeSuiPrivateKey(encoded);
    let keypair: Ed25519Keypair | Secp256k1Keypair;
    if (parsed.scheme === 'ED25519') {
      keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
    } else if (parsed.scheme === 'Secp256k1') {
      keypair = Secp256k1Keypair.fromSecretKey(parsed.secretKey);
    } else {
      throw new Error(`unsupported key scheme ${parsed.scheme}; Splash supports ED25519 and Secp256k1`);
    }

    const signerAddress = keypair.toSuiAddress();
    const expectedAddress = configuredOperatorAddress();
    if (expectedAddress && signerAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error('OPERATOR_SUI_PRIVATE_KEY does not match OPERATOR_SUI_ADDRESS');
    }

    cachedOperatorKeypair = keypair;
    return keypair;
  } catch (error) {
    throw new Error(`Invalid OPERATOR_SUI_PRIVATE_KEY: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseCliGasCoins(stdout: string): OperatorGasCoin[] {
  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) throw new Error(`'sui client gas --json' returned no JSON. stdout: ${stdout.substring(0, 200)}`);
  const coins = JSON.parse(stdout.slice(jsonStart)) as Array<{ gasCoinId: string; mistBalance: number | string }>;
  return coins
    .map((coin) => ({ id: coin.gasCoinId, balance: Number(coin.mistBalance) }))
    .filter((coin) => Number.isFinite(coin.balance) && coin.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

async function getCliReadiness(): Promise<CliReadiness> {
  if (cachedCliReadiness) return cachedCliReadiness;

  try {
    await execFileAsync('sui', ['--version'], { windowsHide: true, timeout: 5000 });
    const { stdout: addressOutput } = await execFileAsync('sui', ['client', 'active-address'], {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 5000,
    });
    const address = addressOutput.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(address)) {
      throw new Error('the Sui CLI has no active managed address');
    }

    const expectedAddress = configuredOperatorAddress();
    if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error('the Sui CLI active address does not match OPERATOR_SUI_ADDRESS');
    }

    const { stdout: gasOutput } = await execFileAsync('sui', ['client', 'gas', '--json'], {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024 * 5,
    });
    if (parseCliGasCoins(gasOutput).length === 0) {
      throw new Error('the Sui CLI active address has no funded gas coins');
    }

    cachedCliReadiness = { ready: true, address };
  } catch (error) {
    const commandError = error as { message?: string; stdout?: string; stderr?: string };
    cachedCliReadiness = {
      ready: false,
      reason: humanizeSuiError(commandError.stdout ?? commandError.message, commandError.stderr ?? ''),
    };
  }
  return cachedCliReadiness;
}

async function resolveSettlementExecution(): Promise<SettlementExecution> {
  const mode = settlementMode();
  if (mode === 'simulate') return 'simulate';
  if (getOperatorKeypair()) return 'sdk';

  const cli = await getCliReadiness();
  if (cli.ready) return 'cli';

  if (mode === 'auto' && process.env.USE_MOCK_APIS === 'true') return 'simulate';

  throw new Error(
    `Real Sui settlement is not configured: ${cli.reason}. ` +
    'Set OPERATOR_SUI_PRIVATE_KEY to the funded ED25519 operator key in the production environment, ' +
    'or configure a persistent funded Sui CLI keystore. Use SUI_SETTLEMENT_MODE=simulate only for an explicitly labeled demo.',
  );
}

function simulatedDigest(seed: string): string {
  const stamp = Date.now().toString(36);
  const tail = createHash('sha256').update(`${seed}:${stamp}`).digest('hex').slice(0, 40);
  return `SIM_${stamp}${tail}`;
}

/** Successful settlement shape returned when the real CLI can't run. */
function simulatedSettlement(seed: string) {
  const cfg = getContractConfig();
  return {
    digest: simulatedDigest(seed),
    packageId: (cfg.packageId ?? '').trim() || 'simulated',
    treasuryId: (cfg.treasuryId ?? '').trim() || 'simulated',
  };
}

function configIdOrThrow(field: ContractConfigField, envKey: string): string {
  const value = (getContractConfig()[field] ?? '').trim();
  if (!value) throw new Error(`${envKey} is not configured. Set it in admin → Contract config (or in .env.local) and try again.`);
  return requireSuiObjectId(value, envKey);
}

function optionalConfigId(field: ContractConfigField): string {
  const value = (getContractConfig()[field] ?? '').trim();
  return value ? requireSuiObjectId(value, field) : '';
}

/**
 * Resolve the fee in bps to pass to settlement.move. Always clamped to
 * CONTRACT_MAX_FEE_BPS so the on-chain E_FEE_EXCEEDED assertion will pass.
 */
function resolveFeeBps(input: { feeBps?: number; targetCurrency?: string }): number {
  const explicit = input.feeBps;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.min(Math.floor(explicit), CONTRACT_MAX_FEE_BPS);
  }
  if (input.targetCurrency) {
    return getCorridorFeeBps(input.targetCurrency);
  }
  return FALLBACK_FEE_BPS;
}

/**
 * Abort code → human message. Update this every time a contract gains a new
 * abort code; the SECURITY.md pre-deploy gate (#20) requires drift = 0.
 * Code-range conventions (loose):
 *   1–99    business_account
 *   100–199 settlement
 *   300–399 peg_monitor
 *   400–499 payment_intent
 *   500–599 audit_anchor
 *   600–699 dual_treasury
 *   700–799 smart_treasury
 *   800–899 receipt_v2
 */
const ABORT_CODES: Record<number, string> = {
  // ── business_account ──────────────────────────────────────────────────────
  1: 'E_ALREADY_VERIFIED — BusinessAccount is already KYB-verified on-chain.',
  2: 'E_EMPTY_SSM_NUMBER — BusinessAccount application submitted without a registration number.',
  3: 'E_EMPTY_KYB_CID — BusinessAccount application submitted without a KYB document CID.',

  // ── settlement ───────────────────────────────────────────────────────────
  100: 'E_NOT_VERIFIED — BusinessAccount is not KYB-verified. Call verify_business with AdminCap first.',
  101: 'E_INSUFFICIENT_FUNDS — Coin value too small (fee > payment). Send a larger coin.',
  102: 'E_EMPTY_BATCH — Empty payments vector. Add at least one payment.',
  103: 'E_FEE_EXCEEDED — fee_bps passed to settle_payment/settle_batch is above MAX_FEE_BPS (200). Check the corridor fee in lib/fx/corridors.ts.',
  104: 'E_INVALID_RECIPIENT — settlement recipient is the zero address.',
  105: 'E_INVALID_AMOUNT — settlement amount or deposit coin value is zero.',
  106: 'E_NOT_ACCOUNT_OWNER — BusinessAccount object was transferred away from its recorded owner; verified status is not transferable (audit S-01).',

  // ── peg_monitor ──────────────────────────────────────────────────────────
  300: 'E_PEG_BROKEN_USDC — USDC deviation > 30 bps. Update peg with valid data.',
  301: 'E_PEG_BROKEN_USDT — USDT deviation > 30 bps. Update peg with valid data.',
  302: 'E_PEG_STALE — Peg price update is older than 60 seconds OR no real update_peg has fired since init. The app refreshes it automatically; verify SPLASH_ADMIN_CAP_ID and SPLASH_PEG_STATE_ID if this appears.',
  303: 'E_TIMESTAMP_REGRESSION — peg_monitor::update_peg called with a Clock timestamp older than the stored one. Indicates a clock bug or replay.',
  304: 'E_INSUFFICIENT_DEPTH — DeepBook cannot completely fill this settlement amount inside the configured depth window.',
  305: 'E_SLIPPAGE_EXCEEDED — DeepBook amount-sized execution price exceeds the configured slippage limit.',
  306: 'E_INVALID_MARKET_PRICE — DeepBook returned an invalid zero mid-price.',
  350: 'E_INVALID_CONFIG — Compliance threshold is outside its bounded safety range.',
  351: 'E_INVALID_CAP — ComplianceCap does not own authority for this ComplianceConfig.',
  352: 'E_SETTLEMENT_PAUSED — Settlement has been paused by the compliance operator.',

  // ── payment_intent ───────────────────────────────────────────────────────
  400: 'E_NOT_PENDING — payment_intent confirm/cancel called on an intent that is not in STATUS_PENDING.',
  401: 'E_EXPIRED — payment_intent::confirm_payment_intent called past intent.expires_at.',
  402: 'E_INSUFFICIENT_PAYMENT — coin value below intent.amount_usd on confirm.',
  403: 'E_NOT_YET_EXPIRED — payment_intent::cancel_payment_intent called before intent.expires_at.',
  404: 'E_UNAUTHORIZED — payment_intent action attempted by an address other than intent.sender.',
  405: 'E_INVALID_AMOUNT — payment_intent::create_payment_intent called with amount_usd = 0.',
  406: 'E_INVALID_RECIPIENT — payment_intent recipient is the zero address.',
  407: 'E_EMPTY_TARGET_CURRENCY — payment_intent target currency is empty.',
  408: 'E_INVALID_FX_RATE — payment_intent FX rate must be greater than zero.',
  409: 'E_EMPTY_BENEFICIARY_REF — payment_intent::create called without a verified counterparty reference hash.',
  410: 'E_EMPTY_CURRENCY — payment_intent::create called without a currency tag.',
  411: 'E_EMPTY_CORRIDOR — payment_intent::create called without a corridor tag.',
  412: 'E_STILL_PENDING — payment_intent::delete_finalized called on a pending intent; confirm or cancel it first.',

  // ── audit_anchor ─────────────────────────────────────────────────────────
  500: 'E_EMPTY_HASH — audit_anchor::anchor_audit_hash called with an empty audit_hash string.',
  501: 'E_EMPTY_ANCHOR — audit_anchor::anchor_audit_hash called with an empty anchor_id.',
  502: 'E_EMPTY_BLOB — audit_anchor::anchor called with an empty Walrus blob id.',

  // ── dual_treasury ────────────────────────────────────────────────────────
  600: 'E_USDT_TTL_EXCEEDED — USDT settlement attempted past USDT_MAX_HOLD_MS (30 minutes). Sweep expected.',
  601: 'E_USDT_BUFFER_EMPTY — dual_treasury::emergency_sweep called with zero balance.',
  602: 'E_USDT_SWEEP_TOO_EARLY — emergency_sweep called before USDT_SWEEP_TRIGGER_MS (27 minutes).',
  603: 'E_USDT_INSUFFICIENT_KYC_TIER — settle_usdt called with kyc_tier below min_kyc_tier.',
  604: 'E_USDT_INSUFFICIENT_BALANCE — settle_usdt requested more than the buffer holds.',
  605: 'E_USDT_ACTIVE_BUFFER — deposit attempted while the USDT buffer still holds an active intake.',
  606: 'E_USDT_ZERO_AMOUNT — dual_treasury deposit or settlement amount is zero.',
  607: 'E_USDT_INVALID_RECIPIENT — dual_treasury recipient is the zero address.',

  // ── smart_treasury ───────────────────────────────────────────────────────
  700: 'E_INSUFFICIENT_BALANCE — smart_treasury::withdraw requested more than the treasury holds.',
  701: 'E_ZERO_AMOUNT — smart_treasury deposit/withdraw called with amount = 0.',
  702: 'E_RECIPIENT_INVALID — smart_treasury::withdraw recipient is the zero address.',
  703: 'E_OPERATING_FLOOR — smart_treasury::allocate would breach the corridor operating minimum.',

  // ── receipt_v2 ───────────────────────────────────────────────────────────
  800: 'E_EMPTY_RECEIPT_ID — receipt_v2::create_receipt called with empty receipt_id.',
  801: 'E_EMPTY_TX_DIGEST — receipt_v2::create_receipt called with empty tx_digest.',
  802: 'E_RECEIPT_ZERO_AMOUNT — receipt_v2::create_receipt called with amount_usd = 0.',
  803: 'E_RECEIPT_INVALID_RECIPIENT — receipt_v2::create_receipt called with recipient = 0x0.',
};

function humanizeSuiError(rawError: string | undefined | null, stderr: string): string {
  const error = [rawError, stderr].filter(Boolean).join('\n') || 'Unknown Sui error';
  if (/No managed addresses|no active managed address/i.test(error)) {
    return 'The Sui CLI has no managed operator address. Configure OPERATOR_SUI_PRIVATE_KEY for server-side settlement, or create and fund a persistent CLI address.';
  }
  const abortMatch = error.match(/MoveAbort\([^)]*?,\s*(\d+)\)/) ?? error.match(/with code\s+(\d+)/i);
  if (abortMatch) {
    const code = Number.parseInt(abortMatch[1], 10);
    const human = ABORT_CODES[code];
    const fnMatch = error.match(/function_name:\s*Some\("([^"]+)"\)/) ?? error.match(/within function\s+'([^']+)'/i);
    const fnName = fnMatch?.[1] ?? '';
    if (human) return `${human}${fnName ? ` (in ${fnName})` : ''}`;
    return `MoveAbort code ${code}${fnName ? ` in ${fnName}` : ''} — ${error}`;
  }
  if (/InsufficientGas/i.test(error)) return 'InsufficientGas — increase --gas-budget.';
  if (/ObjectNotFound/i.test(error)) return `ObjectNotFound — one of the configured object IDs does not exist on the network. Verify .env.local.`;
  if (/ObjectID hex string must start with 0x/i.test(error)) return 'Invalid Sui object ID — one of the configured IDs is missing the 0x prefix. Check SPLASH_PACKAGE_ID, SPLASH_TREASURY_ID, SPLASH_PEG_STATE_ID, SPLASH_BUSINESS_ACCOUNT_ID, SPLASH_TRANSFER_COIN_ID, and SPLASH_ADMIN_CAP_ID in .env.local.';
  return error;
}

async function runSuiCommand(args: string[], maxBuffer = 1024 * 1024 * 10) {
  try {
    return await execFileAsync('sui', args, {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer,
    });
  } catch (error) {
    const commandError = error as { message?: string; stdout?: string; stderr?: string };
    throw new Error(humanizeSuiError(commandError.stdout ?? commandError.message, commandError.stderr ?? ''));
  }
}

type OperatorGasCoin = { id: string; balance: number };

async function executeSdkTransaction(tx: Transaction) {
  const signer = getOperatorKeypair();
  if (!signer) throw new Error('OPERATOR_SUI_PRIVATE_KEY is required for SDK settlement.');

  const result = await suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(humanizeSuiError(result.effects?.status?.error, result.errors?.join('\n') ?? ''));
  }

  // Wait for the tx to be indexed so any objects it created/changed are
  // visible to follow-up transactions in the same flow (composed payments).
  try { await suiClient.waitForTransaction({ digest: result.digest }); } catch {}

  return result;
}

type SuiEventView = {
  type: string;
  data: Record<string, unknown>;
};

export type ComposedAction = {
  kind: 'paid' | 'allocated' | 'anchored';
  label: string;
  eventType: string;
  data: Record<string, unknown>;
};

export type ComposedSettlementResult = {
  digest: string;
  intentId: string;
  intentCreateDigest: string;
  auditAnchorObjectId: string | null;
  smartTreasuryId: string | null;
  events: SuiEventView[];
  objectChanges: unknown[];
  composedActions: ComposedAction[];
  demo: boolean;
};

function resultEvents(result: Awaited<ReturnType<typeof executeSdkTransaction>>): SuiEventView[] {
  return (result.events ?? []).map((event) => ({
    type: event.type,
    data: (event.parsedJson && typeof event.parsedJson === 'object'
      ? event.parsedJson
      : {}) as Record<string, unknown>,
  }));
}

function eventBySuffix(events: SuiEventView[], suffix: string) {
  return events.find((event) => event.type.endsWith(suffix)) ?? null;
}

function requireConfiguredRecipient(inputRecipient: string) {
  const configured = getContractConfig().testRecipientAddress;
  return requireSuiAddress(configured || inputRecipient, 'Composed payment recipient');
}

function configuredSmartTreasuryId() {
  const value = getContractConfig().smartTreasurySuiId.trim();
  return value ? requireSuiObjectId(value, 'SPLASH_SMART_TREASURY_SUI_ID') : '';
}

async function requireSdkExecution() {
  const execution = await resolveSettlementExecution();
  if (execution !== 'sdk') {
    throw new Error(
      'The composed payment proof requires OPERATOR_SUI_PRIVATE_KEY so one server-signed SDK transaction can confirm, allocate, and anchor atomically.',
    );
  }
}

export async function createPaymentIntentOnSui(input: {
  recipient: string;
  amountMist: number;
  targetCurrency: string;
  fxRateScaled: number;
}) {
  await requireSdkExecution();
  const packageId = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const recipient = requireConfiguredRecipient(input.recipient);
  const amountMist = Math.max(1, Math.floor(input.amountMist));
  const fxRateScaled = Math.max(1, Math.floor(input.fxRateScaled));
  const tx = new Transaction();
  tx.setGasBudget(process.env.SUI_COMPOSED_GAS_BUDGET ?? '30000000');
  tx.moveCall({
    target: `${packageId}::payment_intent::create_payment_intent`,
    arguments: [
      tx.pure.address(recipient),
      tx.pure.u64(amountMist),
      tx.pure.string(input.targetCurrency.toUpperCase()),
      tx.pure.u64(fxRateScaled),
      tx.object('0x6'),
    ],
  });

  const result = await executeSdkTransaction(tx);
  const events = resultEvents(result);
  const created = eventBySuffix(events, '::payment_intent::IntentCreated');
  const intentId = typeof created?.data.intent_id === 'string' ? created.data.intent_id : '';
  if (!intentId) {
    throw new Error(`PaymentIntent creation succeeded but IntentCreated was missing. Digest: ${result.digest}`);
  }

  return {
    digest: result.digest,
    intentId,
    event: created,
  };
}

export async function confirmComposedPaymentOnSui(input: {
  intentId: string;
  intentCreateDigest: string;
  paymentMist: number;
  treasuryAmountMist: number;
  auditHash: string;
  anchorId: string;
  backingBlobId: string;
}): Promise<ComposedSettlementResult> {
  await requireSdkExecution();
  const packageId = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const adminCapId = configIdOrThrow('adminCapId', 'SPLASH_ADMIN_CAP_ID');
  const businessAccountId = configIdOrThrow('businessAccountId', 'SPLASH_BUSINESS_ACCOUNT_ID');
  const smartTreasuryId = configuredSmartTreasuryId();
  const paymentMist = Math.max(1, Math.floor(input.paymentMist));
  const treasuryAmountMist = Math.max(0, Math.floor(input.treasuryAmountMist));

  if (treasuryAmountMist > 0 && !smartTreasuryId) {
    throw new Error('SPLASH_SMART_TREASURY_SUI_ID is required when treasuryAmountMist is greater than zero.');
  }

  const tx = new Transaction();
  tx.setGasBudget(process.env.SUI_COMPOSED_GAS_BUDGET ?? '30000000');
  const [paymentCoin] = tx.splitCoins(tx.gas, [paymentMist]);
  const settlementReceipt = tx.moveCall({
    target: `${packageId}::payment_intent::confirm_payment_intent`,
    arguments: [
      tx.object(input.intentId),
      paymentCoin,
      tx.object('0x6'),
    ],
  });

  tx.moveCall({
    target: `${packageId}::audit_anchor::anchor`,
    arguments: [
      settlementReceipt,
      tx.pure.vector('u8', utf8Bytes(input.auditHash)),
      tx.pure.vector('u8', utf8Bytes(input.backingBlobId)),
      tx.object('0x6'),
    ],
  });

  if (treasuryAmountMist > 0) {
    const [treasuryCoin] = tx.splitCoins(tx.gas, [treasuryAmountMist]);
    tx.moveCall({
      target: `${packageId}::smart_treasury::deposit`,
      typeArguments: ['0x2::sui::SUI'],
      arguments: [
        tx.object(smartTreasuryId),
        treasuryCoin,
        tx.object('0x6'),
      ],
    });
  }

  tx.moveCall({
    target: `${packageId}::audit_anchor::anchor_audit_hash`,
    arguments: [
      tx.object(adminCapId),
      tx.pure.string(input.auditHash),
      tx.pure.string(input.anchorId),
      tx.pure.string(input.backingBlobId),
      tx.pure.address(businessAccountId),
      tx.object('0x6'),
    ],
  });

  const result = await executeSdkTransaction(tx);
  const events = resultEvents(result);
  const paid = eventBySuffix(events, '::payment_intent::IntentConfirmed');
  const allocated = eventBySuffix(events, '::smart_treasury::TreasuryDeposited');
  const settlementAnchored = eventBySuffix(events, '::audit_anchor::SettlementAnchored');
  const anchored = eventBySuffix(events, '::audit_anchor::AuditAnchored');
  const auditAnchorObjectId =
    typeof anchored?.data.anchor_object === 'string' ? anchored.data.anchor_object : null;

  if (!paid || !settlementAnchored || !anchored || (treasuryAmountMist > 0 && !allocated)) {
    throw new Error(`Composed transaction succeeded but required proof events were missing. Digest: ${result.digest}`);
  }

  return {
    digest: result.digest,
    intentId: input.intentId,
    intentCreateDigest: input.intentCreateDigest,
    auditAnchorObjectId,
    smartTreasuryId: smartTreasuryId || null,
    events,
    objectChanges: result.objectChanges ?? [],
    composedActions: [
      {
        kind: 'paid',
        label: 'Payment intent confirmed',
        eventType: paid.type,
        data: paid.data,
      },
      ...(allocated
        ? [{
            kind: 'allocated' as const,
            label: 'Reserve allocated to Smart Treasury',
            eventType: allocated.type,
            data: allocated.data,
          }]
        : []),
      {
        kind: 'anchored',
        label: 'Audit proof anchored on Sui',
        eventType: anchored.type,
        data: anchored.data,
      },
    ],
    demo: false,
  };
}

export async function anchorAuditHashOnSui(input: {
  auditHash: string;
  anchorId: string;
  backingBlobId: string;
}) {
  await requireSdkExecution();
  const packageId = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const adminCapId = configIdOrThrow('adminCapId', 'SPLASH_ADMIN_CAP_ID');
  const businessAccountId = configIdOrThrow('businessAccountId', 'SPLASH_BUSINESS_ACCOUNT_ID');
  const tx = new Transaction();
  tx.setGasBudget(process.env.SUI_AUDIT_ANCHOR_GAS_BUDGET ?? '20000000');
  tx.moveCall({
    target: `${packageId}::audit_anchor::anchor_audit_hash`,
    arguments: [
      tx.object(adminCapId),
      tx.pure.string(input.auditHash),
      tx.pure.string(input.anchorId),
      tx.pure.string(input.backingBlobId),
      tx.pure.address(businessAccountId),
      tx.object('0x6'),
    ],
  });
  const result = await executeSdkTransaction(tx);
  const anchored = eventBySuffix(resultEvents(result), '::audit_anchor::AuditAnchored');
  if (!anchored) throw new Error(`Audit anchor event missing. Digest: ${result.digest}`);
  return {
    digest: result.digest,
    anchorObjectId: typeof anchored.data.anchor_object === 'string' ? anchored.data.anchor_object : null,
    event: anchored,
  };
}

export async function refreshPegOnSui(input: { usdcPrice: number; usdtPrice: number }) {
  await requireSdkExecution();
  const packageId = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const pegStateId = configIdOrThrow('pegStateId', 'SPLASH_PEG_STATE_ID');
  const adminCapId = configIdOrThrow('adminCapId', 'SPLASH_ADMIN_CAP_ID');
  const usdcDeviationPpm = Math.max(0, Math.round(Math.abs(input.usdcPrice - 1) * 1_000_000));
  const usdtDeviationPpm = Math.max(0, Math.round(Math.abs(input.usdtPrice - 1) * 1_000_000));

  const tx = new Transaction();
  tx.setGasBudget(process.env.SUI_PEG_UPDATE_GAS_BUDGET ?? '10000000');
  tx.moveCall({
    target: `${packageId}::peg_monitor::update_peg`,
    arguments: [
      tx.object(pegStateId),
      tx.object(adminCapId),
      tx.pure.u64(usdcDeviationPpm),
      tx.pure.u64(usdtDeviationPpm),
      tx.object('0x6'),
    ],
  });

  const result = await executeSdkTransaction(tx);
  return {
    digest: result.digest,
    usdcDeviationPpm,
    usdtDeviationPpm,
  };
}

export async function getOperatorWalletInfo(): Promise<{
  address: string;
  totalMist: number;
  totalSui: string;
  coinCount: number;
}> {
  const signer = getOperatorKeypair();
  if (signer) {
    const address = signer.toSuiAddress();
    const coins = await listSdkGasCoins(address);
    const totalMist = coins.reduce((sum, coin) => sum + coin.balance, 0);
    return {
      address,
      totalMist,
      totalSui: (totalMist / 1_000_000_000).toFixed(6),
      coinCount: coins.length,
    };
  }

  const cli = await getCliReadiness();
  if (cli.ready) {
    const coins = await listOperatorGasCoins();
    const totalMist = coins.reduce((sum, coin) => sum + coin.balance, 0);
    return {
      address: cli.address,
      totalMist,
      totalSui: (totalMist / 1_000_000_000).toFixed(6),
      coinCount: coins.length,
    };
  }

  return {
    address: configuredOperatorAddress() || '0x0000000000000000000000000000000000000000000000000000000000000000',
    totalMist: 0,
    totalSui: '0.000000',
    coinCount: 0,
  };
}

async function listOperatorGasCoins(): Promise<OperatorGasCoin[]> {
  const { stdout } = await runSuiCommand(['client', 'gas', '--json']);
  return parseCliGasCoins(stdout);
}

async function listSdkGasCoins(address: string): Promise<OperatorGasCoin[]> {
  const coins: OperatorGasCoin[] = [];
  let cursor: string | null | undefined;

  do {
    const page = await suiClient.getCoins({ owner: address, cursor, coinType: '0x2::sui::SUI' });
    coins.push(
      ...page.data
        .map((coin) => ({ id: coin.coinObjectId, balance: Number(coin.balance) }))
        .filter((coin) => Number.isFinite(coin.balance) && coin.balance > 0),
    );
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  return coins.sort((a, b) => b.balance - a.balance);
}

/**
 * Pick the largest operator coin to use as gas, and return any extra coins
 * that must be merged into it inside the PTB to cover `neededMist`.
 *
 * Throws if the operator's total balance is insufficient.
 */
async function planGasCoin(neededMist: number): Promise<{ primaryId: string; mergeIds: string[] }> {
  const coins = await listOperatorGasCoins();
  if (coins.length === 0) {
    throw new Error('Operator wallet has no SUI coins. Fund the operator address.');
  }

  const total = coins.reduce((sum, coin) => sum + coin.balance, 0);
  if (total < neededMist) {
    throw new Error(`Operator wallet has ${total} MIST but transfer needs ${neededMist} MIST (payment + gas). Top up the operator wallet.`);
  }

  const [primary, ...rest] = coins;
  const mergeIds: string[] = [];
  let accumulated = primary.balance;

  for (const coin of rest) {
    if (accumulated >= neededMist) break;
    mergeIds.push(coin.id);
    accumulated += coin.balance;
  }

  return { primaryId: primary.id, mergeIds };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function updatePegOnSui(): Promise<void> {
  const SPLASH_PACKAGE_ID = optionalConfigId('packageId');
  const SPLASH_PEG_STATE_ID = optionalConfigId('pegStateId');
  const SPLASH_ADMIN_CAP_ID = optionalConfigId('adminCapId');

  if (!SPLASH_ADMIN_CAP_ID) {
    console.warn('[Sui Peg Update] SPLASH_ADMIN_CAP_ID not set — skipping auto peg refresh. Settlement may fail with E_PEG_STALE.');
    return;
  }
  if (!SPLASH_PACKAGE_ID || !SPLASH_PEG_STATE_ID) {
    console.warn('[Sui Peg Update] Package or peg state not configured — skipping peg refresh.');
    return;
  }

  // Deviation in ppm from $1.00: 0 = healthy peg, max allowed on-chain = 3,000 ppm (0.30%).
  // Function signature: update_peg(peg_state, admin_cap, usdc_deviation_ppm, usdt_deviation_ppm, clock)
  const usdcDeviationPpm = process.env.SPLASH_PEG_USDC_DEVIATION_PPM ?? '0';
  const usdtDeviationPpm = process.env.SPLASH_PEG_USDT_DEVIATION_PPM ?? '0';

  console.log('[Sui Peg Update] Refreshing peg (USDC dev:', usdcDeviationPpm, 'ppm, USDT dev:', usdtDeviationPpm, 'ppm)...');
  const { stdout, stderr } = await runSuiCommand([
    'client', 'call',
    '--package', SPLASH_PACKAGE_ID,
    '--module', 'peg_monitor',
    '--function', 'update_peg',
    '--args', SPLASH_PEG_STATE_ID, SPLASH_ADMIN_CAP_ID, usdcDeviationPpm, usdtDeviationPpm, '0x6',
    '--gas-budget', process.env.SUI_PEG_UPDATE_GAS_BUDGET ?? '10000000',
    '--json',
  ], 1024 * 1024 * 5);

  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`Peg refresh produced no JSON. stdout: ${stdout.substring(0, 200)} stderr: ${stderr.substring(0, 200)}`);
  }

  const output = JSON.parse(stdout.slice(jsonStart)) as SuiCliCallOutput;
  if (output.effects?.status?.status !== 'success') {
    throw new Error(`Peg refresh failed: ${humanizeSuiError(output.effects?.status?.error, stderr)}`);
  }
  console.log('[Sui Peg Update] Peg refreshed:', output.digest);
}

export type SettlementBatchRow = {
  name?: string;
  address?: string;
  country?: string;
  purpose?: string;
  amount?: string;
};

type SuiCliCallOutput = {
  digest?: string;
  effects?: {
    transactionDigest?: string;
    status?: {
      status?: string;
      error?: string;
    };
  };
};

function moneyToMicro(value: number) {
  return Math.max(0, Math.round(value * 1_000_000));
}

function utf8Bytes(value: string) {
  return Array.from(new TextEncoder().encode(value));
}

function requireSuiAddress(value: string, label: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte Sui wallet address (0x + 64 hex chars). Got: "${value}". Set SPLASH_TEST_RECIPIENT_ADDRESS to a real wallet address — not an object ID.`);
  }

  return value;
}

function requireSuiObjectId(value: string, label: string) {
  if (!/^0x[a-fA-F0-9]+$/.test(value)) {
    throw new Error(`${label} must be a Sui object/package ID starting with 0x. Got: "${value}". Check ${label} in .env.local.`);
  }

  return value;
}

export async function recordSingleTransferOnSui(input: {
  transferId: string;
  recipient: string;
  amountUsd: number;
  stablecoinAmountMicro: number;
  /** ISO 4217 code of the destination corridor (e.g. 'PHP'). */
  targetCurrency?: string;
  /** Override the corridor fee. Bounded to CONTRACT_MAX_FEE_BPS. */
  feeBps?: number;
}) {
  const execution = await resolveSettlementExecution();
  if (execution === 'simulate') {
    const sim = simulatedSettlement(input.transferId);
    console.warn(`[Sui Single Transfer] sui CLI unavailable or simulate mode — recording SIMULATED settlement. transfer=${input.transferId} digest=${sim.digest}`);
    return sim;
  }
  const cfg = getContractConfig();
  const SPLASH_PACKAGE_ID = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const SPLASH_TREASURY_ID = configIdOrThrow('treasuryId', 'SPLASH_TREASURY_ID');
  const SPLASH_PEG_STATE_ID = configIdOrThrow('pegStateId', 'SPLASH_PEG_STATE_ID');
  const SPLASH_COMPLIANCE_CONFIG_ID = configIdOrThrow('complianceConfigId', 'SPLASH_COMPLIANCE_CONFIG_ID');
  const DEEPBOOK_POOL_ID = configIdOrThrow('deepbookPoolId', 'DEEPBOOK_POOL_ID');
  const SPLASH_BUSINESS_ACCOUNT_ID = configIdOrThrow('businessAccountId', 'SPLASH_BUSINESS_ACCOUNT_ID');
  if (!cfg.usdcType) throw new Error('USDC_TYPE is not configured. Set it in admin → Contract config (or in .env.local) and try again.');
  const USDC_TYPE = cfg.usdcType;
  if (!cfg.deepbookQuoteType) throw new Error('DEEPBOOK_QUOTE_TYPE is not configured. Set it in admin → Contract config.');
  const DEEPBOOK_QUOTE_TYPE = cfg.deepbookQuoteType;
  const SPLASH_TEST_RECIPIENT_ADDRESS = cfg.testRecipientAddress;

  const recipientAddress = SPLASH_TEST_RECIPIENT_ADDRESS || input.recipient;
  requireSuiAddress(recipientAddress, 'Transfer recipient');

  const feeBps = resolveFeeBps({ feeBps: input.feeBps, targetCurrency: input.targetCurrency });

  // Use at least 1_000_000 MIST so the fee calc (≤ MAX_FEE_BPS = 200 bps)
  // leaves a positive net amount per the contract's E_INSUFFICIENT_FUNDS check.
  const paymentMist = Math.max(1_000_000, input.stablecoinAmountMicro);

  // Peg refresh is bundled into the same PTB below — no separate tx, no staleness race.
  const SPLASH_ADMIN_CAP_ID = configIdOrThrow('adminCapId', 'SPLASH_ADMIN_CAP_ID');
  const usdcDeviationPpm = process.env.SPLASH_PEG_USDC_DEVIATION_PPM ?? '0';
  const usdtDeviationPpm = process.env.SPLASH_PEG_USDT_DEVIATION_PPM ?? '0';

  const gasBudget = process.env.SUI_RECORD_SETTLEMENT_GAS_BUDGET ?? '10000000';

  if (execution === 'sdk') {
    const tx = new Transaction();
    tx.setGasBudget(gasBudget);
    tx.moveCall({
      target: `${SPLASH_PACKAGE_ID}::peg_monitor::update_peg`,
      arguments: [
        tx.object(SPLASH_PEG_STATE_ID),
        tx.object(SPLASH_ADMIN_CAP_ID),
        tx.pure.u64(usdcDeviationPpm),
        tx.pure.u64(usdtDeviationPpm),
        tx.object('0x6'),
      ],
    });
    const [payment] = tx.splitCoins(tx.gas, [paymentMist]);
    tx.moveCall({
      target: `${SPLASH_PACKAGE_ID}::settlement::settle_payment`,
      typeArguments: [USDC_TYPE, DEEPBOOK_QUOTE_TYPE],
      arguments: [
        tx.object(SPLASH_TREASURY_ID),
        tx.object(SPLASH_BUSINESS_ACCOUNT_ID),
        tx.object(SPLASH_PEG_STATE_ID),
        tx.object(SPLASH_COMPLIANCE_CONFIG_ID),
        tx.object(DEEPBOOK_POOL_ID),
        payment,
        tx.pure.address(recipientAddress),
        tx.pure.u64(feeBps),
        tx.object('0x6'),
      ],
    });

    const result = await executeSdkTransaction(tx);
    return {
      digest: result.digest,
      packageId: SPLASH_PACKAGE_ID,
      treasuryId: SPLASH_TREASURY_ID,
    };
  }

  // The PTB will split `paymentMist` from the gas coin and burn up to
  // `gasBudget` MIST for fees, so the chosen gas coin must cover both.
  const { primaryId, mergeIds } = await planGasCoin(paymentMist + Number(gasBudget));

  // PTB: optionally merge fragmented coins into the gas coin, then split the
  // payment from gas and call settle_payment. This avoids a static
  // SPLASH_TRANSFER_COIN_ID that gets consumed after one use, and lets a
  // wallet with many small coins still fund a large transfer.
  const ptbArgs: string[] = ['client', 'ptb'];
  if (mergeIds.length > 0) {
    ptbArgs.push('--merge-coins', 'gas', `[${mergeIds.map((id) => `@${id}`).join(',')}]`);
  }
  ptbArgs.push(
    // 1. Push fresh Pyth-derived peg reading on chain (atomic with settle below)
    '--move-call',
    `${SPLASH_PACKAGE_ID}::peg_monitor::update_peg`,
    `@${SPLASH_PEG_STATE_ID}`,
    `@${SPLASH_ADMIN_CAP_ID}`,
    usdcDeviationPpm,
    usdtDeviationPpm,
    '@0x6',
    // 2. Split payment from gas
    '--split-coins', 'gas', `[${paymentMist}]`,
    '--assign', 'payment',
    // 3. Settle — assert_pegged reads the freshly-updated PegState from step 1.
    //    Published v1 requires fee_bps before the Clock argument.
    '--move-call',
    `${SPLASH_PACKAGE_ID}::settlement::settle_payment`,
    `<${USDC_TYPE},${DEEPBOOK_QUOTE_TYPE}>`,
    `@${SPLASH_TREASURY_ID}`,
    `@${SPLASH_BUSINESS_ACCOUNT_ID}`,
    `@${SPLASH_PEG_STATE_ID}`,
    `@${SPLASH_COMPLIANCE_CONFIG_ID}`,
    `@${DEEPBOOK_POOL_ID}`,
    'payment.0',
    `@${recipientAddress}`,
    feeBps.toString(),
    '@0x6',
    '--gas-coin', `@${primaryId}`,
    '--gas-budget', gasBudget,
    '--json',
  );

  console.log('[Sui Single Transfer] Calling sui client ptb with:', {
    package: SPLASH_PACKAGE_ID,
    usdcType: USDC_TYPE,
    function: 'settle_payment',
    paymentMist,
    feeBps,
    targetCurrency: input.targetCurrency,
    recipient: recipientAddress,
    gasCoin: primaryId,
    mergedCoinCount: mergeIds.length,
  });

  const { stdout, stderr } = await runSuiCommand(ptbArgs);

  console.log('[Sui Single Transfer] CLI stdout:', stdout.substring(0, 500));
  console.log('[Sui Single Transfer] CLI stderr:', stderr.substring(0, 500));

  const jsonStart = stdout.indexOf('{');

  if (jsonStart === -1) {
    throw new Error(`Sui CLI did not return JSON output. stdout: ${stdout.substring(0, 200)}, stderr: ${stderr.substring(0, 200)}`);
  }

  const output = JSON.parse(stdout.slice(jsonStart)) as SuiCliCallOutput;
  const digest = output.digest ?? output.effects?.transactionDigest ?? null;
  const status = output.effects?.status?.status;

  if (!digest || status !== 'success') {
    const errorMsg = humanizeSuiError(output.effects?.status?.error, stderr);
    console.error('[Sui Single Transfer] Transaction failed:', errorMsg);
    throw new Error(errorMsg);
  }

  console.log('[Sui Single Transfer] Transaction successful:', digest);

  return {
    digest,
    packageId: SPLASH_PACKAGE_ID,
    treasuryId: SPLASH_TREASURY_ID,
  };
}

export async function recordBatchSettlementOnSui(input: {
  batchId: string;
  rows: SettlementBatchRow[];
  totalUsd: number;
  /** ISO 4217 code of the destination corridor (e.g. 'PHP'). One fee per batch. */
  targetCurrency?: string;
  /** Override the corridor fee. Bounded to CONTRACT_MAX_FEE_BPS. */
  feeBps?: number;
}) {
  const execution = batchExecutionOverride() ?? await resolveSettlementExecution();
  if (execution === 'simulate') {
    const sim = simulatedSettlement(input.batchId);
    console.warn(`[Sui Batch Settlement] simulate mode (or CLI unavailable) — recording SIMULATED settlement. batch=${input.batchId} rows=${input.rows.length} digest=${sim.digest}`);
    return { ...sim, simulated: true as const };
  }
  const cfg = getContractConfig();
  const SPLASH_PACKAGE_ID = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const SPLASH_TREASURY_ID = configIdOrThrow('treasuryId', 'SPLASH_TREASURY_ID');
  const SPLASH_PEG_STATE_ID = configIdOrThrow('pegStateId', 'SPLASH_PEG_STATE_ID');
  const SPLASH_COMPLIANCE_CONFIG_ID = configIdOrThrow('complianceConfigId', 'SPLASH_COMPLIANCE_CONFIG_ID');
  const DEEPBOOK_POOL_ID = configIdOrThrow('deepbookPoolId', 'DEEPBOOK_POOL_ID');
  const SPLASH_BUSINESS_ACCOUNT_ID = configIdOrThrow('businessAccountId', 'SPLASH_BUSINESS_ACCOUNT_ID');
  if (!cfg.usdcType) throw new Error('USDC_TYPE is not configured. Set it in admin → Contract config (or in .env.local) and try again.');
  const USDC_TYPE = cfg.usdcType;
  if (!cfg.deepbookQuoteType) throw new Error('DEEPBOOK_QUOTE_TYPE is not configured. Set it in admin → Contract config.');
  const DEEPBOOK_QUOTE_TYPE = cfg.deepbookQuoteType;
  const SPLASH_TEST_RECIPIENT_ADDRESS = cfg.testRecipientAddress;
  const feeBps = resolveFeeBps({ feeBps: input.feeBps, targetCurrency: input.targetCurrency });

  // Peg refresh is bundled into the same PTB below — no separate tx, no staleness race.
  const SPLASH_ADMIN_CAP_ID = configIdOrThrow('adminCapId', 'SPLASH_ADMIN_CAP_ID');
  const usdcDeviationPpm = process.env.SPLASH_PEG_USDC_DEVIATION_PPM ?? '0';
  const usdtDeviationPpm = process.env.SPLASH_PEG_USDT_DEVIATION_PPM ?? '0';

  const gasBudget = process.env.SUI_RECORD_SETTLEMENT_GAS_BUDGET ?? '10000000';

  const paymentObjects = input.rows.map((row) => {
    const amount = moneyToMicro(Number.parseFloat(row.amount ?? '0'));
    const recipient = requireSuiAddress(SPLASH_TEST_RECIPIENT_ADDRESS || row.address || '', `Batch recipient ${row.name ?? row.address ?? ''}`.trim());
    return { recipient, amount };
  });

  if (execution === 'sdk') {
    const tx = new Transaction();
    tx.setGasBudget(gasBudget);
    tx.moveCall({
      target: `${SPLASH_PACKAGE_ID}::peg_monitor::update_peg`,
      arguments: [
        tx.object(SPLASH_PEG_STATE_ID),
        tx.object(SPLASH_ADMIN_CAP_ID),
        tx.pure.u64(usdcDeviationPpm),
        tx.pure.u64(usdtDeviationPpm),
        tx.object('0x6'),
      ],
    });
    const payments = paymentObjects.map((payment) =>
      tx.moveCall({
        target: `${SPLASH_PACKAGE_ID}::settlement::new_payment`,
        arguments: [tx.pure.address(payment.recipient), tx.pure.u64(payment.amount)],
      }),
    );
    const paymentVector = tx.makeMoveVec({
      type: `${SPLASH_PACKAGE_ID}::settlement::Payment`,
      elements: payments,
    });
    tx.moveCall({
      target: `${SPLASH_PACKAGE_ID}::settlement::settle_batch`,
      typeArguments: [USDC_TYPE, DEEPBOOK_QUOTE_TYPE],
      arguments: [
        tx.object(SPLASH_ADMIN_CAP_ID),
        tx.object(SPLASH_TREASURY_ID),
        tx.object(SPLASH_BUSINESS_ACCOUNT_ID),
        tx.object(SPLASH_PEG_STATE_ID),
        tx.object(SPLASH_COMPLIANCE_CONFIG_ID),
        tx.object(DEEPBOOK_POOL_ID),
        paymentVector,
        tx.pure.u64(feeBps),
        tx.object('0x6'),
      ],
    });

    const result = await executeSdkTransaction(tx);
    return {
      digest: result.digest,
      packageId: SPLASH_PACKAGE_ID,
      treasuryId: SPLASH_TREASURY_ID,
    };
  }

  const ptbArgs = ['client', 'ptb',
    // 1. Push fresh Pyth-derived peg reading on chain (atomic with settle_batch below)
    '--move-call',
    `${SPLASH_PACKAGE_ID}::peg_monitor::update_peg`,
    `@${SPLASH_PEG_STATE_ID}`,
    `@${SPLASH_ADMIN_CAP_ID}`,
    usdcDeviationPpm,
    usdtDeviationPpm,
    '@0x6',
  ];

  paymentObjects.forEach((payment, index) => {
    ptbArgs.push(
      '--move-call',
      `${SPLASH_PACKAGE_ID}::settlement::new_payment`,
      `@${payment.recipient}`,
      payment.amount.toString(),
      '--assign',
      `payment_${index}`,
    );
  });

  ptbArgs.push(
    '--make-move-vec',
    `<${SPLASH_PACKAGE_ID}::settlement::Payment>`,
    `[${paymentObjects.map((_, index) => `payment_${index}`).join(',')}]`,
    '--assign',
    'payments',
    // AdminCap gates pooled liquidity; compliance + DeepBook guard the amount.
    '--move-call',
    `${SPLASH_PACKAGE_ID}::settlement::settle_batch`,
    `<${USDC_TYPE},${DEEPBOOK_QUOTE_TYPE}>`,
    `@${SPLASH_ADMIN_CAP_ID}`,
    `@${SPLASH_TREASURY_ID}`,
    `@${SPLASH_BUSINESS_ACCOUNT_ID}`,
    `@${SPLASH_PEG_STATE_ID}`,
    `@${SPLASH_COMPLIANCE_CONFIG_ID}`,
    `@${DEEPBOOK_POOL_ID}`,
    'payments',
    feeBps.toString(),
    '@0x6',
    '--gas-budget',
    gasBudget,
    '--json',
  );

  console.log('[Sui Batch Settlement] Calling sui client call with:', {
    package: SPLASH_PACKAGE_ID,
    module: 'settlement',
    function: 'settle_batch',
    feeBps,
    targetCurrency: input.targetCurrency,
    args: ptbArgs,
  });

  const { stdout, stderr } = await runSuiCommand(ptbArgs);

  console.log('[Sui Batch Settlement] CLI stdout:', stdout.substring(0, 500));
  console.log('[Sui Batch Settlement] CLI stderr:', stderr.substring(0, 500));

  const jsonStart = stdout.indexOf('{');

  if (jsonStart === -1) {
    throw new Error(`Sui CLI did not return JSON output. stdout: ${stdout.substring(0, 200)}, stderr: ${stderr.substring(0, 200)}`);
  }

  const output = JSON.parse(stdout.slice(jsonStart)) as SuiCliCallOutput;
  const digest = output.digest ?? output.effects?.transactionDigest ?? null;
  const status = output.effects?.status?.status;

  if (!digest || status !== 'success') {
    const errorMsg = humanizeSuiError(output.effects?.status?.error, stderr);
    console.error('[Sui Batch Settlement] Transaction failed:', errorMsg);
    throw new Error(errorMsg);
  }

  console.log('[Sui Batch Settlement] Transaction successful:', digest);

  return {
    digest,
    packageId: SPLASH_PACKAGE_ID,
    treasuryId: SPLASH_TREASURY_ID,
  };
}

export type ComplianceControls = {
  configured: boolean;
  maxDeviationPpm: number;
  maxStalenessMs: number;
  maxSlippageBps: number;
  minDepthBaseUnits: number;
  paused: boolean;
};

const DEFAULT_COMPLIANCE_CONTROLS: ComplianceControls = {
  configured: false,
  maxDeviationPpm: 3_000,
  maxStalenessMs: 60_000,
  maxSlippageBps: 100,
  minDepthBaseUnits: 100_000_000,
  paused: false,
};

export async function readComplianceControls(): Promise<ComplianceControls> {
  const config = getContractConfig();
  if (!config.complianceConfigId) return DEFAULT_COMPLIANCE_CONTROLS;
  try {
    const object = await suiClient.getObject({ id: config.complianceConfigId, options: { showContent: true } });
    const content = object.data?.content;
    if (!content || content.dataType !== 'moveObject') return DEFAULT_COMPLIANCE_CONTROLS;
    const fields = content.fields as Record<string, unknown>;
    return {
      configured: true,
      maxDeviationPpm: Number(fields.max_deviation_ppm),
      maxStalenessMs: Number(fields.max_staleness_ms),
      maxSlippageBps: Number(fields.max_slippage_bps),
      minDepthBaseUnits: Number(fields.min_depth_base_units),
      paused: fields.paused === true || fields.paused === 'true',
    };
  } catch {
    return DEFAULT_COMPLIANCE_CONTROLS;
  }
}

export async function updateComplianceControls(input: Omit<ComplianceControls, 'configured'>) {
  const packageId = configIdOrThrow('packageId', 'SPLASH_PACKAGE_ID');
  const configId = configIdOrThrow('complianceConfigId', 'SPLASH_COMPLIANCE_CONFIG_ID');
  const capId = configIdOrThrow('complianceCapId', 'SPLASH_COMPLIANCE_CAP_ID');
  if (!getOperatorKeypair()) throw new Error('OPERATOR_SUI_PRIVATE_KEY is required to update compliance controls.');

  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::compliance_config::update`,
    arguments: [
      tx.object(configId),
      tx.object(capId),
      tx.pure.u64(input.maxDeviationPpm),
      tx.pure.u64(input.maxStalenessMs),
      tx.pure.u64(input.maxSlippageBps),
      tx.pure.u64(input.minDepthBaseUnits),
    ],
  });
  tx.moveCall({
    target: `${packageId}::compliance_config::set_paused`,
    arguments: [tx.object(configId), tx.object(capId), tx.pure.bool(input.paused)],
  });
  return executeSdkTransaction(tx);
}
