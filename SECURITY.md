# Splash Protocol — Security Audit & Monitoring Report

**Scope**: All Move modules under `move/sources/` (8 modules)
**Methodology**: OtterSec-style review — capability access control, resource handling, integer arithmetic, authorization, event traceability, upgrade & pause posture, Move-specific patterns (hot-potato, abilities, UID hygiene).
**Audit date**: 2026-05-29
**Audited build**: `move/sources/` at HEAD (post `fee_bps` parameterization)
**Reviewer**: Splash engineering — internal pre-production sweep

---

## Executive Summary

| Severity      | Count | Status (truth pass 2026-07-02) |
| ------------- | ----- | -------------------------------- |
| Critical      | 3     | **3 Open**                       |
| High          | 6     | 1 Fixed (H-06) / **5 Open**      |
| Medium        | 8     | **8 Open**                       |
| Low           | 6     | **6 Open / advisory**            |
| Informational | 4     | Convention / housekeeping        |

**Truth-pass correction:** the prior summary overstated scaffold remediation.
No Phase A Move rewrites have shipped in this branch. The detailed findings
below are the source of truth until the named Move modules are rewritten and
their tests pass. The only previously verified fixed item retained here is
H-06 fee-bps parameterization.

The protocol cleanly separates settlement, peg monitoring, business identity, and dual-stablecoin TTL handling — those four modules (`settlement`, `peg_monitor`, `business_account`, `dual_treasury`) are well-structured and resource-safe.

The remaining four modules (`smart_treasury`, `payment_intent`, `audit_anchor`, `receipt_v2`) are explicitly labelled "Phase 1 scaffold" in their headers. They are **not production-grade** in their current form — `smart_treasury::add_usdc` is fundamentally broken, `payment_intent::create_payment_intent` accepts spoofed sender addresses, and several functions have no authorization at all. **Do not publish these scaffold modules to mainnet** without rewriting.

---

## Re-audit pass — 2026-07-13

**Scope**: all 9 modules under `move/sources/` at HEAD. Methodology: OtterSec
checklist (capabilities, authority, asset flow, replay, events, upgrade
posture) + OpenZeppelin math standards. `sui move build` passes (CLI 1.59.1).
`sui move test` is blocked by a pre-existing incompatibility between the
pinned deepbook rev's own test files and the CLI stdlib — unrelated to
`splash_protocol` sources; tracked as a toolchain item.

**Verification of prior findings.** The scaffold rewrites HAVE landed in this
tree: C-01/C-02 (smart_treasury holds a real `Balance<T>`), C-03 + H-01/02/03
(payment_intent binds sender via `tx_context`, uses `&Clock`, refunds
overpay), H-05 (peg state initializes broken-until-first-update), M-01/M-02
(audit_anchor AdminCap-gated, real verification), M-03/L-05 (receipt_v2
immutable + gated). The "Open" statuses in the 2026-05-29 table below are
retained as history; module doc-comments name the finding IDs they fix.

**New findings (this pass):**

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| S-01 | Medium | `BusinessAccount` has `store`, so a KYB-verified account object can be transferred/sold; `settle_payment` accepted any holder. **Fixed**: `settle_payment` now asserts `owner == tx_context::sender` (abort 106 `E_NOT_ACCOUNT_OWNER`). Ability itself cannot change in an upgrade — flag for next package version. | Fixed (mitigation) |
| S-02 | Medium | `SettlementPool.protocol_fees` had no extraction path — protocol revenue permanently locked in the shared object. **Fixed**: AdminCap-gated `withdraw_fees` + `FeesWithdrawn` event. | Fixed |
| S-03 | Low | `ComplianceCap` (`key`-only) could never be rotated to a new custodian. **Fixed**: `transfer_cap`. | Fixed |
| S-04 | Low | Shared `PaymentIntent` objects lived forever after finalization (storage growth). **Fixed**: `delete_finalized` (abort 412 `E_STILL_PENDING`). | Fixed |
| S-05 | Low | Raw u128 fee math in `settlement` replaced with OpenZeppelin `u64::mul_div(..., rounding::down())` — checked overflow, rounding documented as payer-favoring. | Fixed |
| S-06 | Info | `AdminCap` has `key, store` — publicly transferable/wrappable. Custody policy must treat it as a bearer asset; ability change requires a new package (upgrade rules forbid ability edits). | Advisory |
| S-07 | Info | `settle_batch` attributes `PaymentExecuted` events to whichever `BusinessAccount` the operator passes; attribution is operator-trusted, not chain-enforced. | Advisory |
| S-08 | Info | `payment_intent::create` mints its `SettleReceipt` at creation time, so `SettlementAnchored` can fire for intents that never confirm. Off-chain indexers must join on `IntentConfirmed` before treating an anchor as a settlement. | Advisory |
| S-09 | Info | `assert_deepbook_liquidity` in the caller-facing `settle_payment` path reads a caller-chosen `Pool<T, QuoteAsset>`; a permissionlessly-created pool with self-provided liquidity satisfies the guard. Acceptable today because the guard only gates the caller's own funds, but do not repurpose it to protect pooled funds. | Advisory |

New abort codes to mirror in `lib/server/sui-settlement.ts::ABORT_CODES`:
`106 E_NOT_ACCOUNT_OWNER`, `412 E_STILL_PENDING`.

---

## Custody & liquidity pass — 2026-08-13

**Scope**: the capability split required by `docs/splash-wallet-onboarding-custody-spec.md`
§10 (cold multisig holds money authority; hot operator key runs the daemons),
plus a live-fire investigation of why batch payouts never settled on testnet.
Methodology: same OtterSec checklist, plus reproduction against the live
testnet SUI/DBUSDC pool `0x1c19362c…`.

**New findings (this pass):**

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| S-10 | Medium | Every routine attestation (`peg_monitor::update_peg`, `audit_anchor::anchor_audit_hash`, `receipt_v2::create_receipt`, `smart_treasury::emit_rebalance`) required `&AdminCap` — the same cap that authorizes withdrawals. Because the peg daemon must sign every ~30s, `AdminCap` could never move to the cold 2-of-3 multisig, so a compromised operator host held full money authority. **Fixed**: new `AttestationCap` (`key` only, no `store` — non-transferable, minted/destroyed by `AdminCap`) gates the four non-financial writes; `AdminCap` keeps withdraw/allocate/redeem/config only. | Fixed |
| S-11 | High | `peg_monitor::assert_deepbook_liquidity` rejected **100% of batches regardless of liquidity**, via two independent bugs: (a) it required `remaining_base == 0`, unsatisfiable on a lot-quantized book whose input-fee quote path also deducts the taker fee from the input — measured remainder was ~0.098 SUI at every size from 1.1 to 5.0; (b) slippage was priced against the *requested* quantity, charging the unfilled dust as if it executed at zero, turning a real 56 bps into a reported 809 bps and tripping `E_SLIPPAGE_EXCEEDED` on a healthy pool. **Fixed**: require `filled/requested >= MIN_FILL_BPS` (9,000) and price the filled base. Arithmetic pinned in `tests/deepbook-liquidity-guard.test.mjs`. | Fixed (needs republish) |
| S-12 | Medium | `settle_batch` calls `assert_deepbook_liquidity` against pooled funds — exactly the repurposing **S-09** warns against. The pool argument is operator-supplied and DeepBook pools are permissionlessly creatable, so a compromised operator could stand up a pool, seed it with their own liquidity, and satisfy the depth and slippage asserts trivially while draining the shared `SettlementPool`. **Fixed**: `ComplianceConfig.allowed_deepbook_pools: VecSet<ID>` (non-empty, capped at `MAX_ALLOWED_POOLS = 8`, mutated only through `allow_pool` / `disallow_pool`, each emitting its own event); `assert_deepbook_liquidity` now calls `assert_pool_allowed(config, object::id(pool))` **before reading a single field off the pool** (abort 353). Off-chain preflight in `lib/server/sui-settlement.ts::assertDeepbookPoolWhitelisted` blocks a mismatched `DEEPBOOK_POOL_ID` before the PTB is built; encoding semantics pinned in `tests/deepbook-pool-whitelist.test.mjs`. | Fixed (needs republish) |

New abort codes to mirror in `lib/server/sui-settlement.ts::ABORT_CODES`:
`107 E_BELOW_MINIMUM` (settlement below `min_settlement_amount`), `304
E_INSUFFICIENT_DEPTH` (now also fires on a sub-`MIN_FILL_BPS` fill), `353
E_POOL_NOT_ALLOWED`, `354 E_TOO_MANY_POOLS`, `355 E_POOL_LIST_EMPTY`.

**S-09 status.** The advisory said "do not repurpose [the DeepBook guard] to
protect pooled funds". S-12 is that repurposing, and the whitelist is what makes
it defensible: the guard now measures a venue the protocol chose rather than one
the caller chose. S-09 stays Advisory — the guard still proves depth on a book
the settlement never trades against, so it is a sanity check on market
conditions, not a proof of execution.

**Publish dependency.** S-11 and the `min_settlement_amount` field on
`ComplianceConfig` are source-level fixes. The deployed package is immutable
and predates both, so batch payouts stay blocked on-chain until the package is
republished and `scripts/set-compliance-config.mjs` runs against the new
`ComplianceConfig`. See `docs/KEY-CEREMONY-RUNBOOK.md` §4.

---

## Adversarial pass — 2026-08-13 (application tier)

**Scope**: 24 agents across two workflows — Move authority, Move arithmetic,
server authority, off-chain money path, ABI drift, compliance state machines,
then a second sweep modelling three real incidents: **Step Finance** (Jan 2026,
~$30-40M — compromised executive *devices*, not a contract bug), **Cetus** (May
2025, $223M on Sui — `checked_shlw` used the wrong overflow threshold and Move's
`<<` truncates instead of aborting), and **Hedgey** ($44.7M — unvalidated
caller-supplied parameters). Every finding was put to an independent refuter;
what follows survived.

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| A-01 | Critical | The 6-digit payout code on both money routes was validated with `/^\d{6}$/` and nothing else — no secret, no verification, no MFA dependency in the repo. `000000` authorized a payroll run out of the shared `SettlementPool`. `requireTotp` was persisted, rendered, and read by no authorization path. **Fixed**: RFC 6238 on `node:crypto`, pinned against the RFC 4226 published vectors, single-use per step, fail-closed when unenrolled. | Fixed |
| A-02 | High | `transfers/authorize` took the paying account from `body.businessAccountId`; `GET /api/ledger` with no `accountId` returned every account's entries. Enumerate, then debit. **Fixed**: account derived from the session in all four routes; a foreign id gets 403. | Fixed |
| A-03 | High | A stablecoin funding session CREDITed the payer's ledger but the route DEBITed only on the `held` branch — one deposit funded two payouts. **Fixed**: payer debited for every source, non-negative assert before settlement. | Fixed |
| A-04 | High | Every settlement PTB called `update_peg(0,0)` as command #1 and `settle_payment` — which calls `assert_pegged` — as command #2. **The on-chain peg circuit breaker read a perfect peg the same transaction had written one instruction earlier.** It could not fail. **Fixed**: the pushed value is measured; a fabricated `$1.00` from the Pyth mock fallback is never attested; with no live reading the command is omitted so `PegState` goes stale and `assert_pegged` aborts (302). | Fixed |
| A-05 | High | Admin session tokens were `nonce.hmac(nonce)` — no issue time, no identity, no revocation. A copied cookie verified forever; sign-out cleared only the browser's copy. **Fixed**: signed issue time enforced server-side, subject bound, `revokeAllAdminSessions()`. | Fixed |
| A-06 | High | `SPLASH_TEST_RECIPIENT_ADDRESS` unconditionally overrides the beneficiary on every live path, per row in a batch — and was writable at runtime via `PUT /api/admin/contracts`, whose entire authorization was "is there a session". A stolen admin cookie redirected every payout, persisted to disk, dashboard unchanged. **Fixed**: env-only (403 from that route), refused on mainnet, logged. | Fixed |
| A-07 | High | Batch authorization minted a fresh batch per call — a dropped response plus a re-submit paid every recipient twice. **Fixed**: idempotency key. | Fixed |
| A-08 | Medium | `perTransferLimitUsd` / `dailyLimitUsd` / `approvalThresholdUsd` / `requireDualApproval` were persisted, cross-checked and rendered — and enforced nowhere. **Fixed**: enforced in both routes; daily volume summed from the ledger. | Fixed |
| A-09 | Medium | `settle_batch` looped an unbounded caller vector (one event + one created Coin per row) under a flat 10,000,000 MIST budget. Above ~1,023 rows Sui's 1,024-event / 1,024-command ceilings make it unexecutable at any budget. **Fixed**: `MAX_BATCH_ROWS = 256` (abort 108), gas scales with row count. | Fixed |
| A-10 | High | `ComplianceConfig.paused` gates `settle_payment`/`settle_batch`, but the live customer path is `payment_intent::confirm_payment_intent`, which imports neither `compliance_config` nor `peg_monitor` — pausing halted batches while transfers kept executing. **Mitigated off-chain** (both routes check `paused`); the chain-side guard needs the republish. | Mitigated |
| A-11 | High | **Nothing bounds an `AdminCap` call.** `withdraw_fees`, `smart_treasury::withdraw`, `allocate` (whose `operating_minimum` is a caller-supplied `u64` — pass `0`) and `settle_batch` have no amount cap, velocity limit, cooldown or timelock. One PTB signed with the operator key drains the pool, the fees and the treasury. This is the Step Finance shape exactly. | **Open** |
| A-12 | High | The S-10 cap split is **not in effect at runtime**: `attestationCapObjectId()` falls back to `adminCapId`, `.env.example` ships `SPLASH_ATTESTATION_CAP_ID=` empty, and `recordBatchSettlementOnSui` passes `SPLASH_ADMIN_CAP_ID` directly. The hot key is still the money authority until the ceremony runs. | **Open** |
| A-13 | High | Seal enforces no per-tenant policy: one global allowlist object, and the operator key decrypts every blob ever sealed. Seal also falls open to a hardcoded AES key while Walrus publishes for real. `/api/audit/[intentId]` has no ownership check. | **Open** |
| A-14 | Medium | Batch rows are USD micro-units passed as SUI MIST on a `SettlementPool<SUI>`. $100 becomes 100,000,000 MIST = 0.1 SUI. Recipients are underpaid and the on-chain minimum is effectively disabled on that path. Correct for 6-decimal USDC; wrong for the 9-decimal SUI pool. Needs a product decision on what the SUI pool represents. | **Open** |
| A-15 | Medium | No beneficiary screening on either payout path — Elliptic is referenced but is a stub, and the compliance engine is wired only to the 0xWal proposal route. Batch pays unscreened, caller-supplied raw Sui addresses. | **Open** |
| A-16 | Medium | Operator-signed PTBs are never serialized and never `setGasPayment` — concurrent `after()` callbacks sign different transactions over the same owned gas coins. Best case a spurious FAILED transfer; worst case the operator's whole coin set locks for an epoch. | **Open** |
| A-17 | High | Nothing ever writes `KYB_SUBMITTED` or `KYB_PROVIDER_APPROVED`, so `approveOrgKybOnChain` always throws and `verify_business` is unreachable. `readOrgKybState` also fails open to `ACTIVE` when the org row is missing, returning a success shape with `digest: ''` for a verification that never happened. | **Open** |
| A-18 | Medium | `/api/kyb/cases/latest` matches on public `businessName` / `registrationNumber` with no org check, returning review notes, risk tier, Sumsub applicant id and every document's filename + SHA-256. | **Open** |
| A-19 | Medium | `resolveAuthorityForSession` auto-provisions a missing user as `checker` → `APPROVER`, so any email that can mint a session becomes a valid second signature. zkLogin also hardcodes `DEFAULT_ORG_ID` and makes nonce binding optional at the client's discretion. | **Open** |

**What the incidents imply here.** Step Finance died on key custody, not code —
which makes **A-11 and A-12 the highest-value open items in this repo**: the cap
split is written but not in effect, and even once it is, no value-moving Move
function has a ceiling, so a single compromised hot key still drains everything
in one transaction. Cetus died on a guard whose constant was wrong; the
equivalent check here passed — `DEEPBOOK_PRICE_SCALING = 1e9` matches DeepBook's
own `FLOAT_SCALING`, verified against the pinned dependency source, and the fee
math already routes through OpenZeppelin's checked `u64::mul_div`. The
denomination defect that did surface (**A-14**) is a units error at the
application boundary, not in the contract arithmetic.

---

**Numbering note.** `S-06`/`S-07` are the 2026-07-13 advisories above
(`AdminCap` abilities; `settle_batch` event attribution). The cap split and the
DeepBook guard fix are `S-10`/`S-11` — module doc-comments use those IDs.

---

## Findings

### C-01 · `smart_treasury::add_usdc` always aborts on non-zero coins
**Severity**: Critical
**Status**: Open
**Location**: `move/sources/smart_treasury.move:51-61`

The function adds the coin's value to `treasury.usdc_balance` (a `u64` counter), then calls `coin::destroy_zero(usdc_coin)`. `destroy_zero` aborts if the coin's value is non-zero — the only path that succeeds is depositing a coin of value 0, in which case the counter is also incremented by 0.

In effect, the treasury contract **cannot accept any USDC at all**. Worse, the function pretends to credit the deposit before aborting, which would mislead off-chain callers reading the partial transaction trace.

The type parameter is also wrong — the function accepts `Coin<SUI>` but the field name and comments say USDC.

**Recommendation**: Rewrite to actually store the deposit in a `Balance<USDC>` field on `SmartTreasury`. Use a proper type parameter (`Coin<USDC>`). Emit a `UsdcDeposited` event. Remove the `destroy_zero` call. Mirror the pattern in `dual_treasury::deposit`.

---

### C-02 · `SmartTreasury` does not actually hold any value
**Severity**: Critical
**Status**: Open
**Location**: `move/sources/smart_treasury.move:13-20`

`SmartTreasury` only contains `u64` counters (`usdc_balance`, `usd_balance`). There is no `Balance<T>` field on the struct. All "balances" are accounting fiction with no on-chain backing.

`rebalance_treasury` increments/decrements `usd_balance` based on an admin-supplied `amount_usd` argument — there is no movement of any actual coin. A compromised admin can mint arbitrary phantom balances; the dashboard treasury figure is unreliable.

**Recommendation**: Add `usdc_balance: Balance<USDC>` and `usd_balance: Balance<USD>` (or whatever stable type represents USD on Sui). All mutations must move real balance via `balance::join` / `balance::split`. Remove the `u64` counters or expose them as views derived from `balance::value(&field)`.

---

### C-03 · `payment_intent::create_payment_intent` accepts a spoofed `sender`
**Severity**: Critical
**Status**: Open
**Location**: `move/sources/payment_intent.move:26-50`

The function takes `sender: address` as a caller-supplied parameter rather than reading it from `tx_context::sender(ctx)`. Any caller can therefore create a `PaymentIntent` claiming any address as the sender.

Downstream, `recipient` is also caller-supplied — combined, an attacker can fabricate intents that look like they came from victim A and pay attacker B, and these intents will appear in off-chain indexers as if A authorized them. Even if `confirm_payment_intent` requires the right coin, the intent itself is a falsifiable record on-chain.

**Recommendation**:
```move
public entry fun create_payment_intent(
    recipient: address,
    amount_usd: u64,
    target_currency: String,
    fx_rate_usd_local: u64,
    ctx: &mut TxContext,
) {
    let sender = tx_context::sender(ctx);
    // ...
}
```
Same pattern applies anywhere `address` is taken as an argument that should be the caller.

---

### H-01 · `payment_intent` uses `epoch_timestamp_ms` instead of `Clock`
**Severity**: High
**Status**: Open
**Location**: `move/sources/payment_intent.move:34, 59, 72`

`tx_context::epoch_timestamp_ms(ctx)` returns the epoch start time, which only advances at epoch boundaries (~24 hours on Sui mainnet). The 5-minute expiration window (`now + 300_000`) is therefore meaningless — within the same epoch, every `confirm_payment_intent` and `cancel_payment_intent` call sees the same "now". Expired intents may remain confirmable for hours; pending intents may show as expired immediately at an epoch boundary.

**Recommendation**: Take `clock: &Clock` parameter and call `clock::timestamp_ms(clock)`. Match the pattern already used in `peg_monitor` and `settlement`.

---

### H-02 · `payment_intent::confirm_payment_intent` has no sender authorization
**Severity**: High
**Status**: Open
**Location**: `move/sources/payment_intent.move:53-68`

The intent is a `key + store` shared object after `transfer::share_object`. Any address can therefore call `confirm_payment_intent` with any coin ≥ `intent.amount_usd`. This enables griefing — a third party can confirm an intent at the cheapest possible payment, draining the recipient's expected upside, or front-running with a cheaper coin denomination.

**Recommendation**: Add `assert!(tx_context::sender(ctx) == intent.sender, E_UNAUTHORIZED);`. Or: require the caller to hold a `PaymentApprovalCap` minted at intent creation and given only to the sender.

---

### H-03 · `payment_intent::confirm_payment_intent` over-charges silently
**Severity**: High
**Status**: Open
**Location**: `move/sources/payment_intent.move:61-67`

The check is `amount >= intent.amount_usd`, then the **entire** payment coin is forwarded to the recipient. If the caller supplies a 100 SUI coin to confirm a 1 SUI intent, the recipient receives 100 SUI and there is no refund of the 99 SUI overpay.

**Recommendation**: Split the coin: `let to_pay = coin::split(&mut payment, intent.amount_usd, ctx);` then transfer only `to_pay` to recipient and return `payment` to sender (or destroy if zero). Pattern already used in `settlement::settle_payment` for the fee split.

---

### H-04 · `business_account::submit_application` has no rate limit
**Severity**: High
**Status**: Open
**Location**: `move/sources/business_account.move:39-59`

Anyone can call `submit_application` unlimited times, each call mints a new `BusinessAccount` UID. This is a denial-of-service vector against the off-chain Sumsub indexer and inflates the object table.

**Recommendation**: Either gate creation behind a fee (a small SUI burn deters spam), or require a one-shot capability minted by AdminCap. At minimum, enforce one-application-per-sender by storing applicant addresses in a shared `Table<address, bool>` and asserting they're not already present.

---

### H-05 · `peg_monitor::init_peg_state` initializes deviation at 0 with a current timestamp
**Severity**: High
**Status**: Open
**Location**: `move/sources/peg_monitor.move:47-56`

After init, `assert_pegged` passes immediately because (a) deviations are 0 and (b) `last_update_ms = clock::timestamp_ms(clock)`. The first ~60 seconds after init, settlements proceed against zero peg data — without the operator daemon ever having pushed a real Pyth reading.

**Recommendation**: Initialize `usdc_deviation_ppm: MAX_DEVIATION_PPM + 1` and `usdt_deviation_ppm: MAX_DEVIATION_PPM + 1` so `assert_pegged` aborts until the first real `update_peg` lands. Or set `last_update_ms = 0` so staleness check fails until first update.

---

### H-06 · Fee gouging via unbounded `FEE_BPS`
**Severity**: High
**Status**: **Fixed** (2026-05-29)
**Location**: `move/sources/settlement.move`

The contract previously hardcoded `FEE_BPS = 150` (1.50%) while the off-chain quote engine, dashboards, and marketing all advertised 0.80%–1.10%. There was no way to align them without redeploying. Worse — any future change to the constant required a full upgrade.

**Resolution**: `settle_payment` and `settle_batch` now take `fee_bps: u64` as a parameter, bounded by `MAX_FEE_BPS = 200` via `assert!(fee_bps <= MAX_FEE_BPS, E_FEE_EXCEEDED)`. Per-corridor fees are defined in `lib/fx/corridors.ts` and passed by the off-chain settlement layer. The contract emits `fee_bps` in `PaymentSettled` and `PaymentExecuted` for full auditability. See `lib/fx/corridors.ts`, `lib/server/sui-settlement.ts`, and `lib/sui/contracts.ts` for the off-chain pieces.

---

### M-01 · `audit_anchor::anchor_audit_hash` has no caller authorization
**Severity**: Medium
**Status**: Open
**Location**: `move/sources/audit_anchor.move:20-34`

Anyone can call this entry function and create `AuditAnchor` shared objects with arbitrary hashes. The audit trail can be polluted with junk anchors that look identical to real ones to a naive off-chain reader.

**Recommendation**: Gate with `AdminCap` (matching `peg_monitor::update_peg`), or accept a `BusinessAccount` reference and assert `is_verified`. Add a `business_account_id: address` field to the anchor so off-chain indexers can filter by tenant.

---

### M-02 · `audit_anchor::verify_anchor` is tautological
**Severity**: Medium
**Status**: Open
**Location**: `move/sources/audit_anchor.move:37-39`

`verify_anchor(anchor, hash)` simply returns `anchor.audit_hash == hash` — i.e. it tells you whether the value you supplied matches the value already on the anchor you read. This provides no independent verification; off-chain callers can do the comparison themselves without calling the contract.

**Recommendation**: Either remove this function (misleading), or change it to verify against a Merkle root or Walrus CID that the anchor commits to — i.e. give it meaning beyond a string equality check.

---

### M-03 · `receipt_v2::link_audit_anchor` lacks authorization
**Severity**: Medium
**Status**: Open
**Location**: `move/sources/receipt_v2.move:56-62`

The receipt is a shared object; any caller can mutate `audit_anchor_id` to point to a different (possibly fake) anchor. A receipt's audit linkage is therefore not tamper-evident on chain.

**Recommendation**: Require `AdminCap` OR `assert!(tx_context::sender(ctx) == receipt.sender)`. Better: link the anchor at receipt creation and remove the post-hoc setter entirely (immutable receipts).

---

### M-04 · `smart_treasury::rebalance_treasury` shares an object per call
**Severity**: Medium
**Status**: Open
**Location**: `move/sources/smart_treasury.move:64-93`

Every rebalance call creates a new `TreasuryRebalance` shared object via `transfer::share_object`. Over time this fills the object table with one shared object per rebalance event — expensive in storage and gas, hard to query.

**Recommendation**: Replace with an event: `event::emit(TreasuryRebalanced { ... })`. Events are cheap, queryable from indexers, and don't add to the object table.

---

### M-05 · Magic abort codes throughout scaffold modules
**Severity**: Medium
**Status**: Open
**Location**: `payment_intent.move:58, 59, 62, 72` · `smart_treasury.move:56, 70, 77`

Scaffold modules use bare integers (`assert!(..., 0)`, `assert!(..., 1)`, etc.) instead of named `const E_FOO: u64 = N;` constants. Diagnosing reverts requires reading the source — off-chain error mapping (see `lib/server/sui-settlement.ts::ABORT_CODES`) has no way to associate human-readable strings with anonymous codes.

**Recommendation**: Define named constants at module top, matching the `E_FOO` convention used in `settlement.move` and `peg_monitor.move`. Add the new codes to `lib/server/sui-settlement.ts::ABORT_CODES`.

---

### M-06 · `business_account::AdminCap` is single-key with no rotation
**Severity**: Medium
**Status**: Open (architectural)
**Location**: `move/sources/business_account.move:34-36`

`init` mints one `AdminCap` and transfers it to the deployer. There is no multi-sig, no time-locked rotation, no recovery path. If the deployer's key is lost, every admin function (peg updates, KYB verification, treasury seed) becomes uncallable forever — protocol bricked.

**Recommendation**: Wrap `AdminCap` usage behind a multi-sig pattern at the address level (use Sui multisig), or build an on-chain governance module with N-of-M keyholders that can mint replacement AdminCaps after a timelock. At minimum, document the operational policy: where the key lives, who has access, what the rotation cadence is, what the recovery plan is if the key is lost.

---

### M-07 · `dual_treasury` resets TTL on every deposit
**Severity**: Medium
**Status**: Open
**Location**: `move/sources/dual_treasury.move:62-63`

`deposit` overwrites `buffer.intake_ms = now_ms` on each call. Old funds in the buffer get a fresh TTL whenever new funds are added — meaning a 29-minute-old position can be reset to 0 by depositing 1 wei of USDT, indefinitely keeping funds past the intended `USDT_MAX_HOLD_MS` ceiling. The `emergency_sweep` trigger never fires for actively topped-up buffers.

**Recommendation**: Track per-batch intake (e.g. `Table<u64, u64>` keyed by batch id → intake_ms) and enforce TTL per oldest batch. Or: forbid deposits when `buffer.balance > 0` — force one-batch-at-a-time accounting.

---

### M-08 · `dual_treasury` parameter naming hides cap discard
**Severity**: Medium
**Status**: Open
**Location**: `move/sources/dual_treasury.move:54, 75, 99`

Functions take `cap: &AdminCap` then do `let _ = cap;`. This works (the borrow still requires the cap to exist), but the pattern is non-idiomatic and easy to overlook in review — a future change could remove the `let _` line and the borrow would optimize away, breaking access control silently.

**Recommendation**: Use `_admin: &AdminCap` parameter name (Move/Rust convention for "intentionally unused reference"). Match `peg_monitor::update_peg` style.

---

### L-01 · `settlement.move` `MAX_FEE_BPS = 200` may be too loose
**Severity**: Low
**Status**: Open (advisory)
**Location**: `move/sources/settlement.move:23`

Current corridor fees are 80–110 bps. The 200 bps (2%) ceiling is roughly 2× headroom — defensive but allows a misconfigured quote engine to charge double the highest legitimate fee without aborting.

**Recommendation**: Tighten to 150 bps if no genuine 1.5%+ corridors are planned. Or: emit a `HighFeeWarning` event when `fee_bps > 120` so off-chain monitors can alert on suspicious quotes.

---

### L-02 · `peg_monitor::assert_pegged` aborts on either-stablecoin break
**Severity**: Low
**Status**: Open (intentional conservatism)
**Location**: `move/sources/peg_monitor.move:83-89`

A USDC-denominated settlement aborts if USDT's peg is broken (and vice versa). The conservative posture is reasonable — broad peg stress usually correlates — but it does mean USDT operational issues block USDC flow.

**Recommendation**: Add `assert_pegged_for<T>(state, clock)` variants that only check the relevant stablecoin. Keep the joint check as the default for batch settlements that may mix types.

---

### L-03 · No pause / circuit breaker
**Severity**: Low
**Status**: Open (architectural)
**Location**: All modules

There is no `paused: bool` field gated by AdminCap that would let operators halt settlements in an incident. The only emergency lever is `peg_monitor::update_peg` with deliberately bad data (which halts all settlements but is hacky).

**Recommendation**: Add `PauseState { paused: bool }` shared object and `assert!(!pause.paused, E_PAUSED)` at the top of every settlement entry function. Gate `set_pause` with `AdminCap`.

---

### L-04 · `business_account::submit_application` uses `#[allow(lint(self_transfer))]`
**Severity**: Low
**Status**: Open (design choice)
**Location**: `move/sources/business_account.move:38-58`

`BusinessAccount` is created and transferred to the caller as an owned object. Owned objects are harder to query in dashboards (need to iterate by address) and don't compose with other shared-object flows.

**Recommendation**: Consider making `BusinessAccount` a shared object with an `owner` field. Easier to query, easier to reference in `settle_payment` without ownership transfer juggling.

---

### L-05 · `receipt_v2` doesn't enforce caller is the actual settler
**Severity**: Low
**Status**: Open
**Location**: `move/sources/receipt_v2.move:26-53`

Anyone can call `create_receipt` with any data — there's no link back to a real `PaymentSettled` event or a `SettlementPool` reference. Off-chain readers cannot distinguish a real receipt from a forged one without cross-referencing the `tx_digest` to actual chain history.

**Recommendation**: Require either `AdminCap` OR a reference to the settlement pool whose event the receipt is supposed to attest to. Best: emit receipts as part of `settle_payment` rather than as a separate user-facing entry.

---

### L-06 · `peg_monitor::update_peg` lacks monotonic timestamp check
**Severity**: Low
**Status**: Open
**Location**: `move/sources/peg_monitor.move:59-79`

The function blindly overwrites `last_update_ms` with the current clock. If two PTBs race and the slower one lands second, the chain "remembers" the older timestamp as the latest — which is benign (still fresh) but technically not monotonic. More importantly, an admin replay attack could set the timestamp to an older value... actually no, it always reads from the `Clock`, so this is safe. Mark as informational.

**Recommendation**: Add `assert!(now > state.last_update_ms, E_TIMESTAMP_REGRESSION)` for defense in depth and to catch clock bugs early.

---

### I-01 · Inconsistent `AdminCap` parameter naming
**Severity**: Informational
**Status**: Open
**Location**: cross-module

- `peg_monitor::update_peg` — `_admin: &AdminCap` ✓
- `business_account::verify_business` — `_: &AdminCap`
- `dual_treasury::*` — `cap: &AdminCap` + `let _ = cap;`

Pick one convention (`_admin: &AdminCap` recommended).

---

### I-02 · Mixed module declaration styles
**Severity**: Informational
**Status**: Open
**Location**: cross-module

`settlement`, `business_account`, `peg_monitor`, `dual_treasury` use the short-form `module name;` (newer Move syntax). `smart_treasury`, `payment_intent`, `audit_anchor`, `receipt_v2` use the block form `module name { ... }`. This is a strong signal that the latter four are older or were copy-pasted from scaffold templates — they correlate exactly with the modules carrying the most critical findings.

**Recommendation**: Migrate scaffold modules to short-form once they're properly rewritten.

---

### I-03 · Scaffold vs production status not visible at module level
**Severity**: Informational
**Status**: Open
**Location**: `smart_treasury`, `payment_intent`, `audit_anchor`, `receipt_v2`

These four modules have doc-comments saying "Phase 1 scaffold" but nothing prevents them from being published. There is no compile-time guard preventing accidental mainnet deployment.

**Recommendation**: Add a `#[test_only]` guard until they're hardened, or split them into a `scaffolds/` subdirectory excluded from the production package via `Move.toml`.

---

### I-04 · `peg_monitor::update_peg` doesn't return new state
**Severity**: Informational
**Status**: Open
**Location**: `move/sources/peg_monitor.move:59-79`

Caller has to read `state` afterwards or parse the emitted event. Minor UX friction for PTB authors.

---

## Permanent Monitoring Checklist

These are the items the security/ops team should **always** keep eyes on. Each has a recommended cadence and alert threshold.

### Hot signals (alert immediately)

| # | Signal | Source | Action |
|---|--------|--------|--------|
| 1 | `E_FEE_EXCEEDED` (code 103) appears in any abort | Sui RPC effects | Quote engine drift — investigate `lib/fx/corridors.ts` vs `MAX_FEE_BPS` |
| 2 | `E_PEG_BROKEN_USDC` or `E_PEG_BROKEN_USDT` (300/301) fires more than 1× per hour | Sui RPC effects | Stablecoin issue OR Pyth feed corruption — page on-call |
| 3 | `E_PEG_STALE` (302) for > 5 minutes | Off-chain peg daemon log | Peg daemon down — restart, verify SPLASH_ADMIN_CAP_ID |
| 4 | Any `AdminCap` transfer to an address other than the canonical admin wallet | Sui events filter | Capability theft — rotate immediately |
| 5 | `PaymentSettled.fee_bps` > 150 | Indexer | Off-chain config wrong; advertised rates broken |
| 6 | New `BusinessAccount` objects created at > 10/min | Indexer | Spam / DoS — engage rate limit ASAP |
| 7 | `protocol_fees` balance grows faster than expected | RPC query | Possible fee_bps misconfig OR settlement loop |

### Weekly review

| # | Signal | Action |
|---|--------|--------|
| 8 | `dual_treasury::usdt_age_ms()` for any active buffer > 25 minutes | Investigate why sweep didn't fire |
| 9 | Total `protocol_fees` accrued vs. expected (revenue reconciliation) | Compare against off-chain quote totals |
| 10 | Number of `BusinessVerified` events vs. Sumsub completion rate | Drift = stale verification queue |
| 11 | `PegUpdated.sequence` monotonicity | Gaps suggest dropped operator updates |
| 12 | Settlements aborted vs. settlements succeeded | Trend up = config drift somewhere |

### Quarterly review

| # | Item | Action |
|---|------|--------|
| 13 | AdminCap key rotation — physical custody audit | Confirm hardware wallet, backup MPC shards, signer policy |
| 14 | Re-audit any module that changed since last quarter | Run this report's checklist against diffed code |
| 15 | Re-evaluate `MAX_FEE_BPS` vs. live corridor distribution | Tighten if no corridors are using the headroom |
| 16 | Dependency audit (Sui framework, Pyth, Sumsub, Walrus) | Read changelogs, regression-test |
| 17 | Disaster-recovery drill — simulate Pyth outage, AdminCap loss, peg break | Verify runbooks still work |

### Pre-deploy gate (before any Move upgrade)

| # | Gate | Pass criteria |
|---|------|---------------|
| 18 | Run `sui move test` with full coverage | 100% pass |
| 19 | Run `sui move build` in CI with `--lint` flag | Zero lint warnings |
| 20 | Diff abort codes against `lib/server/sui-settlement.ts::ABORT_CODES` | Every new code added |
| 21 | Re-run this audit checklist on changed modules | Findings ≤ Medium |
| 22 | Bump `MAX_FEE_BPS` only if corridor adds genuinely require it | Justify in PR description |
| 23 | Confirm scaffold modules are not in published package | `Move.toml` excludes them |
| 24 | Confirm peg state initializer aborts until first real update (post-H-05 fix) | Test added |

### Off-chain dependencies — keep these auditable

| # | Dependency | Why it matters | Where to look |
|---|------------|----------------|---------------|
| 25 | `lib/fx/corridors.ts` | Single source of truth for `fee_bps` | Code review on every PR; alert if `feeBps` mutated |
| 26 | `lib/server/pyth.ts` | Drives `update_peg` deviations | Logs should show successful Pyth fetches every cycle |
| 27 | `SPLASH_ADMIN_CAP_ID` env | Required for peg updates | Vault / secret-manager audit trail |
| 28 | `lib/server/sumsub.ts` | KYB verification feed | Sumsub webhook signature verified |
| 29 | `lib/server/walrus.ts` | Audit anchor backing store | Walrus retention policy = 7 yr, blob count monotonic |
| 30 | Sponsor wallet (operator gas) | Settlement won't fire without gas | Balance monitor, refill threshold |

---

## Closing notes

**Highest-leverage next moves**, in priority order:

1. **Fix C-01, C-02, C-03 before any further work on those modules.** They are scaffolds and won't survive a real audit; pretending otherwise is worse than removing them from the package.
2. **Address H-05** (`init_peg_state` opens a 60s settlement window with zero peg data). One-line fix.
3. **Document AdminCap custody policy** (M-06). If the admin key is on a laptop somewhere, the entire protocol is one phishing email from being unrecoverable.
4. **Wire the abort code 103** into `ABORT_CODES` mapping — already done in this revision. Same pattern for any new abort codes scaffold modules add.
5. **Treat the four scaffold modules as deleted for production purposes** until rewritten. Move them under `move/sources/scaffolds/` and exclude from `Move.toml::[package].sources` until ready.

This report should be re-run after any change to `move/sources/` and committed alongside the change.
