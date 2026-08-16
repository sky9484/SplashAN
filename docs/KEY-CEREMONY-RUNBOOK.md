# Key ceremony & fresh-publish runbook — operator key split (spec §5)

**Status:** Move code is written, builds clean, and is committed. **Nothing has been
published.** This runbook is what Sebastian runs on the deploy server to land it.

**Why this exists:** today ONE key signs settlement, wields `AdminCap`, and pays gas.
That is the Step Finance failure mode — one compromised credential is theft *and* audit
forgery in a single transaction. After this ceremony, stealing the hot server key buys an
attacker the ability to write attestations, not to move funds.

---

## 0 · What changed in the code (already committed)

`AttestationCap` is a new capability in `business_account.move`, minted by `AdminCap`:

| Function | Before | After |
|---|---|---|
| `peg_monitor::update_peg` | `&AdminCap` | **`&AttestationCap`** |
| `audit_anchor::anchor_audit_hash` | `&AdminCap` | **`&AttestationCap`** |
| `receipt_v2::create_receipt` | `&AdminCap` | **`&AttestationCap`** |
| `smart_treasury::emit_rebalance` | `&AdminCap` | **`&AttestationCap`** |

Everything that moves value keeps `AdminCap` — all 14 of them: `verify_business`,
`settlement::settle_batch` / `settle_sui_batch` / `withdraw_fees`,
`smart_treasury::init_treasury` / `withdraw` / `allocate` / `redeem`,
`dual_treasury::create_buffer` / `create_and_share_buffer` / `deposit` / `settle_usdt` /
`emergency_sweep`, `compliance_config::create`. `peg_monitor::init_peg_state` stays on
`AdminCap` as a one-time bootstrap.

`AttestationCap` is deliberately **`key` only, no `store`** — it cannot be
`public_transfer`red out of the module, so every custody change goes through
`mint_attestation_cap` / `destroy_attestation_cap` and emits an event. `AdminCap` keeps
`store` precisely so it *can* be moved to a multisig address.

**The app already tolerates both worlds.** `attestationCapObjectId()` in
`lib/server/sui-settlement.ts` uses `SPLASH_ATTESTATION_CAP_ID` when set and falls back to
`SPLASH_ADMIN_CAP_ID` when not. The argument position is identical in both ABIs, so the
current immutable deployment keeps working until you publish — verified live: the full
`scripts/e2e-testnet.mjs` run passes today against `0xec3b06…` with the fallback active.

---

## 1 · ⚠️ The one decision this runbook cannot make for you

**After `AdminCap` moves to a cold 2-of-3 multisig, the hot server can no longer run batch
payouts.**

`settlement::settle_sui_batch` pays recipients out of the shared `SettlementPool` and is
therefore `AdminCap`-gated (correctly — otherwise any hot key could drain the pool). But
the batch PTB *also* pushes a peg reading, which is now `AttestationCap`-gated. So that
one transaction needs **both** caps, and one of them is deliberately offline.

Single transfers are unaffected: `settle_payment` takes no capability, so that path stays
fully hot.

Pick one before the ceremony:

| Option | Consequence |
|---|---|
| **A. Accept it** — batch becomes a deliberate, multisig-signed operation | Safest. Batch payouts stop being push-button and need a signing session. |
| **B. Add a bounded `SettlementCap`** — hot, but limited (per-batch cap, allowlisted pool, expiry) | Keeps batch automated; needs new Move code + its own review. **Not written yet.** |
| **C. Delay** — keep `AdminCap` hot for now, split only the attestation surface | Gets most of the benefit immediately; money authority still on one hot key. |

The code as committed supports A and C unchanged. B is a follow-up.

---

## 2 · Prerequisites

- A Sui CLI that can reach a **gRPC-capable** testnet fullnode. The public JSON-RPC is
  retired (v1.76.0 line); the CLI on the dev box is 1.59.1 and gets `Request rejected`.
  Upgrade it, or publish from the deploy server.
- The three signer addresses for the 2-of-3 multisig (spec §10.1 — **still unanswered**:
  who are they? You + Sebastian + who?). Each signer generates their own key on their own
  machine. Nobody types anybody else's seed.
- A funded gas key, separate from everything else.

---

## 3 · Ceremony

### 3.1 Create the cold multisig (before publishing)
Each of the three signers, independently:
```bash
sui keytool generate ed25519
```
Collect the three **public keys** (never the private keys), then:
```bash
sui keytool multi-sig-address --pks <pk1> <pk2> <pk3> --weights 1 1 1 --threshold 2
```
Record the multisig address. Verify each signer can independently reproduce it from the
same public keys — if the address differs, stop.

### 3.2 Publish the package(s)

⚠️ **`move/` is now TWO packages** (2026-08-17). There is no `move/Move.toml` any more.

**Phase 0 — publish `splash_core` ONLY.**
```bash
cd move/splash_core
sui move build && sui move test        # 10 tests must pass
sui client publish --gas-budget 500000000
```

**Do NOT publish `splash_custody`.** It holds every `Balance<T>` in the system, and the
Labuan MFCA licence does not permit holding client funds. Leaving it unpublished is the
control: there is no flag to flip, because the bytecode does not exist on chain. It
publishes when the e-money licence is granted — see `STATUS.md`.

The current combined package is **immutable**, so this mints a NEW package id and every
shared object from the old package is unusable by the new one.

Record: new **package id**, **AdminCap** object id, and the **UpgradeCap**.

> **Decision made (STATUS.md): `splash_core` publishes IMMUTABLE — burn the `UpgradeCap`.**
> A settlement contract whose logic cannot change is a stronger regulatory position than
> one under multisig, where "who holds the keys" becomes a custody procedure an auditor
> takes on trust. The package split is what makes this affordable: core is six modules
> with no third-party dependencies.
>
> The cost is real — a post-publish bug needs a fresh publish and a full re-bootstrap.
> That is why the independent review gate in `STATUS.md` is not optional.
>
> If you overrule this and keep the `UpgradeCap`, it MUST go into the same cold multisig.
> An unrestricted `UpgradeCap` on a hot key makes the whole cap split meaningless, because
> the package can simply be rewritten.

Then set both package ids in the environment:
```
SPLASH_CORE_PACKAGE_ID=<new core package id>
SPLASH_CUSTODY_PACKAGE_ID=                  # EMPTY in Phase 0 — intentionally
```

### 3.3 Re-bootstrap every shared object
Nothing carries over. Re-create and record ids for:
`compliance_config::create` → `ComplianceConfig` + `ComplianceCap`
  — ⚠️ its signature GAINED TWO parameters:
  **5th, `min_settlement_amount`** — the $100 floor, in the settled coin's MINOR
  UNITS (100_000_000 for 6-decimal USDC). Zero is rejected, so the floor cannot
  be disabled by accident;
  **6th, `allowed_deepbook_pools: vector<ID>`** — the venue whitelist (audit
  S-12). Must be non-empty: pass the DeepBook pool id you intend to run against,
  i.e. exactly what `DEEPBOOK_POOL_ID` will hold. An empty vector aborts (355)
  rather than defaulting to "any pool", because "any pool" is the vulnerability.
  Duplicates abort. Manage it afterwards with
  `scripts/set-compliance-config.mjs --allow-pool <id>` / `--disallow-pool <id>`;
  the last remaining venue cannot be removed — halt with the pause switch instead;
`peg_monitor::init_peg_state` → `PegState`;
`settlement` pool → `SettlementPool<SUI>`;
`smart_treasury::init_treasury` → `SmartTreasury<SUI>`;
`business_account::submit_application` (+ `verify_business`) → `BusinessAccount`;
`dual_treasury` buffer if USDT is in use.

**Drain the old pools first.** Any SUI left in the previous `SettlementPool` /
`SmartTreasury` is only reachable with the OLD `AdminCap` against the OLD package —
withdraw it *before* you retire that key.

### 3.4 Mint the AttestationCap to the hot server
```bash
sui client call --package <NEW_PACKAGE_ID> --module business_account \
  --function mint_attestation_cap --args <OPERATOR_SERVER_ADDRESS> --gas-budget 20000000
```
Record the `AttestationCapMinted` event's `attestation_cap_id`.

### 3.5 Move AdminCap to the cold multisig — LAST
Do this only after 3.3 and 3.4 succeed, because every bootstrap step above needs
`AdminCap` and you will not have convenient access to it afterwards.
```bash
sui client transfer --to <MULTISIG_ADDRESS> --object-id <ADMIN_CAP_ID> --gas-budget 20000000
```
Then **prove you can use it**: execute one trivial `AdminCap`-gated call signed 2-of-3
(e.g. a no-op `verify_business` on a throwaway account) *before* you rely on this in
production. An unrehearsed multisig is an untested backup.

### 3.6 Update environment (both `.env.local` and Vercel)
```
SPLASH_PACKAGE_ID=<new>
SPLASH_ADMIN_CAP_ID=<new>            # now owned by the multisig
SPLASH_ATTESTATION_CAP_ID=<from 3.4> # hot server
SPLASH_PEG_STATE_ID=<new>
SPLASH_TREASURY_ID=<new SettlementPool<SUI>>
SPLASH_SMART_TREASURY_SUI_ID=<new>
SPLASH_BUSINESS_ACCOUNT_ID=<new>
SPLASH_COMPLIANCE_CONFIG_ID=<new>
SPLASH_COMPLIANCE_CAP_ID=<new>
```
Also commit the regenerated `move/Published.toml`.

### 3.7 Verify
```bash
node --use-system-ca --env-file=.env.local scripts/e2e-testnet.mjs
```
Expect peg refresh, payment intent, and composed confirm to pass with
`IntentConfirmed + SettlementAnchored + TreasuryDeposited + AuditAnchored`. The peg and
anchor calls now run on the AttestationCap — if they abort, the cap id is wrong.

---

## 4 · Residual risks (state them honestly)

- **A stolen `AttestationCap` can forge attestations** — audit anchors, receipts, peg
  readings. It cannot move a coin. Containment is off-chain: reject anchors bearing the
  retired cap id. `destroy_attestation_cap` lets the *holder* burn it for rotation, but it
  cannot claw back a cap a thief holds.
- **Peg forgery is the sharpest edge of that.** `update_peg` feeds `assert_pegged`, so a
  hot-key attacker can assert a healthy peg. They still cannot move funds, but they can
  remove one safety check on transactions someone else authorises. Consider whether the
  peg belongs behind its own oracle attestation rather than a plain hot cap.
- **Gas key** holds only SUI, and the **fee wallet** is a plain address, not a signer.
- **Phase-0 honesty:** the operator key carries no customer funds today (settlement is
  demo-denominated). This is key *hygiene* now — but the object model you publish decides
  whether the Phase-1 custody posture is a config change or a rewrite.

---

## 5 · Batch payouts — why they cannot settle until this publish (S-11)

Batch settlement was investigated end-to-end on testnet. Four preconditions must
hold simultaneously; three now do, one is blocked on the contract:

| Precondition | Status |
|---|---|
| `BusinessAccount.is_verified` | ✅ true on `0x23fbe1…` |
| Fresh peg (bundled `update_peg`) | ✅ passes |
| **SettlementPool funded** | ✅ fixed — was **0**; `scripts/fund-settlement-pool.mjs` added, pool now holds 2.1 SUI |
| **DeepBook liquidity guard** | ❌ **unsatisfiable on the deployed contract** |

**Configuration discovered and applied** (`.env.local`):
`DEEPBOOK_POOL_ID=0x1c19362c…` (SUI/DBUSDC), `DEEPBOOK_QUOTE_TYPE=0xf7152c05…::DBUSDC::DBUSDC`.
Verified the pool's on-chain type is exactly the `0xfb28c4cb…::pool::Pool<SUI, DBUSDC>`
the contract expects.

**The blocker is a contract bug, now fixed in source (S-11):**

1. The guard required `remaining_base == 0` — a *perfect* fill. DeepBook books are
   lot-quantized (SUI/DBUSDC lot = 0.1) and the input-fee quote path deducts the
   taker fee from the input, so a sub-lot remainder is ALWAYS returned. Measured
   across 1.1 → 5.0 SUI, the remainder never fell below ~0.093. The assert
   therefore rejected **100% of batches at any size**.
2. Slippage was priced against the *requested* quantity instead of the *filled*
   quantity, charging the unfilled dust as if it executed at zero. On a healthy
   book this reported **809 bps** where the true cost was **56 bps**.

Both are fixed in `move/splash_core/sources/peg_monitor.move` and guarded by
`tests/deepbook-liquidity-guard.test.mjs` (`sui move test` cannot run here — the
pinned DeepBook dependency's own test files fail to compile).

**Also note:** the batch total must exceed the pool's `minSize` (1 SUI on
SUI/DBUSDC). Below it DeepBook fills nothing and returns a zero quote, which the
guard correctly rejects. The e2e batch was 0.009 SUI — 100× too small — and is
now 1.3 SUI.

**Testnet risk parameters were widened deliberately.** `max_slippage_bps` was
raised 30 → 150 via `scripts/set-compliance-config.mjs`, because the testnet
book's spread is ~43 bps and a mainnet-grade 30 bps band captures zero bids.
**Mainnet must keep the tight value** — the script hard-refuses >50 bps on
mainnet.

**After this publish**, re-run `scripts/e2e-testnet.mjs`; the batch flow should
settle for real. If it still aborts 304, re-measure the book — testnet depth
moves.

---

## 6 · Minimum settlement size ($100)

Enforced at four layers so no single bypass opens a sub-minimum payout:

| Layer | Where |
|---|---|
| UI | transfer step + batch authorization summary (blocks before a TOTP is spent) |
| API | `transfers/authorize`, `batches/authorize` → 400 `below_minimum` |
| Policy engine | `evaluatePolicy` → `BLOCK` — the choke point in-chat approval, the queue and submit-time re-evaluation all share |
| Contract | `settlement::settle_payment` and `settle_batch` → abort 107 `E_BELOW_MINIMUM` against `ComplianceConfig.min_settlement_amount` |

The floor applies to a single transfer and to a batch **TOTAL** (not per row — a
payroll run legitimately contains small rows). Internal transfers and treasury
moves are exempt: the floor exists because of corridor settlement fixed costs,
which internal movements do not incur.

Server default is `$100`, overridable with `MIN_SETTLEMENT_USD`. A malformed or
non-positive override falls back to $100 rather than disabling the rule.
On-chain it is `min_settlement_amount` in **minor units**, set at
`compliance_config::create` and changeable with
`scripts/set-compliance-config.mjs --min-settlement <minor units>` (that script
auto-detects whether the deployed contract has the field yet).
