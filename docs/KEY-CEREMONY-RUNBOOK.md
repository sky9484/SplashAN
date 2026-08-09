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

### 3.2 Publish the package
The current package is **immutable**, so this mints a NEW package id and every shared
object from the old package is unusable by the new one.
```bash
cd move
sui move build
sui client publish --gas-budget 500000000
```
Record: new **package id**, **AdminCap** object id, and the **UpgradeCap**.

> Decide deliberately whether to publish immutable again. Immutable means this ceremony is
> the only way to ever change the contract. If you keep the `UpgradeCap`, it must go into
> the same cold multisig — an unrestricted `UpgradeCap` on a hot key makes the whole cap
> split meaningless, because the package can simply be rewritten.

### 3.3 Re-bootstrap every shared object
Nothing carries over. Re-create and record ids for:
`compliance_config::create` → `ComplianceConfig` + `ComplianceCap`;
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
