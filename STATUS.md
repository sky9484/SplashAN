# Splash Phase 1 Build Verification & Perfection Pass

Run date: 2026-06-16
Workspace: `C:\Users\SKYHANDSOME\Documents\phase1`
Network: Sui testnet

## Executive Status

The Phase 1 hero path is now real on testnet:

- One server-signed composed payment path creates a payment intent, confirms it, allocates to SmartTreasury, Seal-encrypts the proof payload, stores ciphertext on Walrus, and anchors the ciphertext hash on Sui.
- Daily audit batching is implemented and verified: completed settlements are Merkle-batched, Seal-encrypted, stored on Walrus, anchored on Sui, and exposed in History with a working "Verify inclusion" action.
- Settings is now a persisted operating-control console reflecting the v7.1 business module.
- Dashboard/admin routes render cleanly in Chrome with no browser console errors.
- `move/sources` was not modified.

## VP-0 - Self Audit

Status: fixed / verified.

Evidence:

- Fabrication scan after changes:
  - Remaining `Math.random()` occurrences are non-proof IDs or intentionally random UX copy. No user-visible live digest/blob/anchor path uses `Math.random()`.
  - `lib/sui/gas.ts` no longer fabricates a realistic digest in live mode; without sponsor/signature it throws unless `USE_MOCK_APIS=true` or `SUI_SETTLEMENT_MODE=simulate`.
- Composed PTB implementation:
  - `lib/server/sui-settlement.ts:365` creates the real payment intent.
  - `lib/server/sui-settlement.ts:404` builds the one-transaction composed confirmation.
  - The transaction calls `payment_intent::confirm_payment_intent`, optional `smart_treasury::deposit<0x2::sui::SUI>`, then `audit_anchor::anchor_audit_hash`.
  - `lib/server/composed-payment.ts:23` ties Seal -> Walrus -> hash -> composed Sui transaction together.
- Signing:
  - `lib/server/sui-settlement.ts` resolves to the SDK signer when `OPERATOR_SUI_PRIVATE_KEY` exists. No Enoki key is required.
- Object type checks:
  - `SPLASH_TREASURY_ID=0xeb96...acff` is `settlement::SettlementPool<0x2::sui::SUI>`, not SmartTreasury.
  - `SPLASH_ADMIN_CAP_ID=0x4d88...bcf4` is `business_account::AdminCap`, owned by `0x7058...27d3`.
  - `SPLASH_SMART_TREASURY_SUI_ID=0xb14e...405d` is `smart_treasury::SmartTreasury<0x2::sui::SUI>`.
- Operator gas after proof runs:
  - `0x7058...27d3` has one gas coin with `3.341784580 SUI`.
- Warning:
  - Local Sui CLI is `1.59.1`; testnet server API is `1.73.1`. SDK signing works, but the CLI should be upgraded.

## VP-1 - Walrus Must Store For Real

Status: fixed.

Implementation:

- `lib/server/walrus.ts:41` stores ciphertext with `PUT $PUBLISHER/v1/blobs`.
- `lib/server/walrus.ts:88` retrieves with `GET $AGGREGATOR/v1/blobs/<blobId>`.
- Blank Walrus config falls back to visibly `DEMO_WALRUS_...`, never a fake real-looking blob.
- Plaintext guard rejects obvious bank/PII keys before upload.

Evidence:

- Official reference used: `https://docs.wal.app/docs/network-reference`
  - Testnet aggregator: `https://aggregator.walrus-testnet.walrus.space`
  - Testnet publisher: `https://publisher.walrus-testnet.walrus.space`
  - HTTP API paths: `PUT /v1/blobs`, `GET /v1/blobs/<BLOB_ID>`
- Real composed transfer Walrus blob: `z_KRD6tjBeNV2Ejj98hcycszHJKP-DMrj4PFvTHVbc8`
- Real daily batch Walrus blob: `CMTn9ca2Z3eIGKVJ-WB83aRFkFhDgYISicPgWvYb-k8`
- Daily verification proved the aggregator bytes hash to the anchored ciphertext hash.

## VP-2 - Seal: Real Or Honestly Labeled

Status: warning, honestly demo-labeled.

Implementation:

- `lib/server/seal.ts:34` provides AES-GCM demo encryption when Seal key-server/package config is blank.
- Policy IDs are visibly `DEMO_SEAL_...`; the UI/API reports `sealMode: "demo"`.
- Pipeline order is Seal-encrypt -> Walrus-store -> Sui-anchor.

Why still demo:

- `SEAL_KEY_SERVER_URLS` and `SEAL_PACKAGE_ID` are not configured. Live threshold encryption is intentionally not claimed.

Evidence:

- Composed payment and daily audit batch ran without Seal crashing.
- Daily batch seal mode: `demo`, policy `DEMO_SEAL_359e9a74f6d50efd`.

## VP-3 - SmartTreasury<SUI> For Allocate Leg

Status: fixed.

Implementation:

- `package.json:11` adds `npm run bootstrap:testnet`.
- `scripts/bootstrap-testnet.ts` initializes `smart_treasury::SmartTreasury<0x2::sui::SUI>` without publishing Move.
- `lib/server/contract-config.ts:40` adds `SPLASH_SMART_TREASURY_SUI_ID`.
- `components/admin/ContractConfigForm.tsx:28` exposes it in admin contract config.
- `lib/server/sui-settlement.ts:353` reads the SmartTreasury object for composed allocation.

Evidence:

- SmartTreasury object: `0xb14e20461b331b0b7110b543fca6c28ec7092ab07ca3e8dd0a958da35fba405d`
- Type: `smart_treasury::SmartTreasury<0x2::sui::SUI>`
- Balance after composed proof: `10000` MIST; lifetime deposited: `10000` MIST.

## VP-4 - AdminCap Type For Prove Leg

Status: verified.

Evidence:

- `SPLASH_ADMIN_CAP_ID=0x4d8813d3846c461a6b1b0c296cbaa8936c44b69edb81a55b6f33fc5ff756bcf4`
- Type: `business_account::AdminCap`
- The same cap successfully emitted the composed `AuditAnchored` event and the daily-batch `AuditAnchored` event.

## VP-5 - Execution / Gas

Status: fixed / verified.

Implementation:

- `lib/server/sui-settlement.ts` signs live protocol calls with `OPERATOR_SUI_PRIVATE_KEY` using the Sui SDK.
- `app/api/cron/update-peg/route.ts:35` now calls the real operator-signed peg refresh instead of sponsored-gas simulation.

Evidence:

- Real peg refresh digest: `4iwGH6tZhqtxLdhn9V5CDFWRcWiuofLrfUQxBHyDQEFj`
- No Enoki key is required.

## VP-6 - Composed PTB End-To-End Proof

Status: fixed.

Implementation:

- `app/api/transfers/authorize/route.ts:101` executes the composed path.
- `components/transfer/StepStatus.tsx` and `components/transfer/StepReceipt.tsx` surface the real proof actions and event data.

Acceptance proof:

- Transfer intent: `ti_mqfl6qki_lk54y39k`
- PaymentIntent object: `0xbdfb568b51bcfb642d8156fccc9c2508a3445a16db1ffe18135747955fc60bcf`
- Intent create digest: `6YGHG7frnXGJJ5EaEabU2C7HPdAfUhDAR9rY7Bea1sNQ`
- Composed tx digest: `q6hMBrZCCB4CpPRyhQWdR32DAeCTfpsHrqwY4CBGNNK`
- Real Walrus blob: `z_KRD6tjBeNV2Ejj98hcycszHJKP-DMrj4PFvTHVbc8`
- Audit hash: `0aa60a2f8860f2061ecf72e76cf8273da2072468119b9006d2b55fd13304a582`
- AuditAnchor object: `0x4dacf349c6b0367a3274a714e25ee043591b551da89cedc9a1eeeee2febd3dff`
- Same transaction emitted:
  - `IntentConfirmed`
  - `TreasuryDeposited`
  - `AuditAnchored`

## VP-7 - Daily Audit Batch

Status: fixed.

Implementation:

- `lib/server/audit-batches.ts:99` builds business-date daily Merkle batches.
- `app/api/cron/audit-batch/route.ts:24` exposes a CRON_SECRET-gated batch job.
- `app/api/audit-batches/verify/route.ts:13` verifies inclusion + Walrus bytes + Sui anchor.
- `app/dashboard/history/page.tsx` surfaces batches and the verify action.

Acceptance proof:

- Batch: `daily-audit:2026-06-16`
- Merkle root: `1fba22a7ebc23982ef69af827c6bd3f43ebe42db2677ad2b656f7ccd6e513979`
- Walrus blob: `CMTn9ca2Z3eIGKVJ-WB83aRFkFhDgYISicPgWvYb-k8`
- Ciphertext hash: `07f002cd3ffde74e76a72632c070b6aafa4171e807cc53301b07313f6ffeb1c8`
- Anchor object: `0x42c6f0c82871d7c23627bce8998e4cfe4f3b5c0d4a5bb33a72a5772fc43ddd84`
- Anchor digest: `5roGGbzNhSi9qztnadx1Yp4rCsXMwQxEMHXoALLWDR7r`
- Verify API result:
  - `inclusionVerified: true`
  - `walrusHashVerified: true`
  - `anchorVerified: true`
  - `verified: true`

## VP-8 - Compliance / Copy CI

Status: verified / tightened.

Evidence:

- `npm run lint` runs `npm run check:copy`.
- Copy check passed.
- Treasury surfaces continue to show: `Projection only - execution disabled pending regulatory approval.`
- Random projected-yield movement was removed from the dashboard overview.
- Market yield remains sourced from `/api/market/yields` and labeled projected/floating.

## VP-9 - Every Page & Button Functional

Status: verified / fixed.

Browser audit:

- Rendered routes with Chrome, no browser console/page errors:
  - `/`
  - `/dashboard`
  - `/dashboard/transfer`
  - `/dashboard/batch`
  - `/dashboard/treasury`
  - `/dashboard/invoices`
  - `/dashboard/recipients`
  - `/dashboard/history`
  - `/dashboard/copilot`
  - `/dashboard/settings`
  - `/admin/login`
  - `/admin/kyb`
  - `/admin/support`
  - `/admin/transactions`
  - `/admin/contracts`
- Admin login works and then renders admin routes after the session cookie is set.
- Settings "Save controls" action verified in browser.
- History "Verify inclusion" action verified in browser.

Known demo-gated integrations:

- PDAX payout adapter returns visibly `DEMO_PDAX_...` until `PDAX_API_KEY` is configured.
- Seal is demo-labeled until `SEAL_PACKAGE_ID` and `SEAL_KEY_SERVER_URLS` are configured.

## VP-10 - Settings = Business Module v7.1

Status: fixed.

Implementation:

- `lib/server/operating-settings.ts:36` reads persisted operating controls.
- `lib/server/operating-settings.ts:45` saves validated settings to ignored local data.
- `app/api/settings/route.ts:8` and `app/api/settings/route.ts:13` expose GET/PUT.
- `app/dashboard/settings/page.tsx:152` renders the v7.1 information panel.

Exact copy present:

- Custody: "held 1:1 in segregated custody, never commingled, never lent, reconciled daily"
- Regulatory: "Labuan FSA Money Broker + DFS application in progress; Labuan -> SG holdco -> MAS; regulator-ready, not yet licensed"
- Treasury: "Smart Treasury models projected Ondo USDY yield; execution gated; projected, not promised"
- Records/privacy: "Seal + Walrus + daily Merkle batches + MemWal behavioral-only"
- Recipient ladder: "payout/sweep/stored"

## Final Validation

Passed:

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `git diff --stat -- move/sources` returned empty output.

Git status summary:

- Modified app/dashboard/API/proof files.
- Added:
  - `lib/server/composed-payment.ts`
  - `lib/server/audit-batches.ts`
  - `lib/server/operating-settings.ts`
  - `app/api/cron/audit-batch`
  - `app/api/audit-batches`
  - `app/api/settings`
  - `scripts/bootstrap-testnet.ts`

## Deployment Notes

- `.env.local` is intentionally ignored and was not committed. Production must receive:
  - `WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space`
  - `WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space`
  - `SPLASH_SMART_TREASURY_SUI_ID=0xb14e20461b331b0b7110b543fca6c28ec7092ab07ca3e8dd0a958da35fba405d`
  - `SUI_SETTLEMENT_MODE=live`
  - `USE_MOCK_APIS=false`
- Do not commit secrets. Rotate secrets that were previously pasted into chat or terminal logs.
- Testnet Walrus can be wiped without warning. Mainnet must use a private authenticated publisher, upload relay, or SDK integration.
