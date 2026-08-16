# Splash — mainnet cutover status

**Target:** Sui mainnet, week 2 September 2026
**Governing constraint:** Labuan MFCA — Splash **cannot hold client funds**.
E-money tier (RM 1.5M, Labuan money broking paras 6.1 + 6.2) is Phase 1.

---

## The design thesis

Non-custody is not a runtime flag. It is a property of the type system.

`splash_core` — the package that publishes to mainnet — contains **no struct
that holds a `Balance<T>`**. Not gated; absent. Client value exists only as a
`Coin<T>` parameter that enters and exits `payment_intent::confirm_payment_intent`
inside a single PTB. There is no object to accumulate into.

> *"How do I know Splash cannot hold my money?"*
>
> Runtime-gate answer: "There's a `LicenceState` object and every custodial
> function asserts against it — let me show you the call sites." Twelve minutes,
> trust required.
>
> Package-split answer: `npm run check:core`. Twelve seconds, no trust required.

`splash_custody` — every `Balance<T>` in the system — publishes **only when the
e-money licence is granted**. Under Phase 0 the bytecode does not exist on chain,
so there is no flag to flip and no assert to forget.

---

## Package layout

```
move/
  splash_core/        ← mainnet, September. NO third-party dependencies.
    business_account.move  payment_intent.move  audit_anchor.move
    receipt_v2.move        compliance_config.move  peg_monitor.move
    tests/core_invariants_tests.move        (10 tests, all passing)

  splash_custody/     ← publishes ONLY on the e-money licence
    settlement.move   smart_treasury.move   dual_treasury.move
    liquidity_guard.move
    tests/custody_tests.move                (blocked — see below)
```

**Why `liquidity_guard` sits in custody.** It exists to protect *pooled* funds,
and pools only exist in custody. Keeping it in core also forced a DeepBook
dependency on the mainnet package — which mattered more than it looked: the
pinned DeepBook rev ships test files that fail to compile against this
toolchain, aborting the whole test build before our modules were reached. That
is why this repo had 93 lines of Move tests. Removing the dependency unblocked
the core suite, which now runs.

**Core has no third-party dependencies at all.** Cetus was drained through a bug
in a third-party math library ([BlockSec](https://blocksec.com/blog/cetus-incident-one-unchecked-shift-drains-223m-largest));
the strongest defence against that class is not auditing the dependency, it is
not having one.

---

## Mainnet gate

Do not publish `splash_core` until every line is checked.

- [x] `sui move build` clean for both packages
- [x] `sui move test` green for `splash_core` — **10 tests** (was 0 runnable)
- [ ] `sui move test` for `splash_custody` — **BLOCKED** by the pinned DeepBook
      rev's own test files (`unbound function 'destroy'` in
      `deepbook/tests/vault/vault_tests.move`). Tests are written and will run
      when the pin moves. Not a mainnet blocker: custody does not publish in
      Phase 0.
- [x] `grep -r "Balance<" move/splash_core/sources/` returns nothing —
      CI-enforced by `npm run check:core`, which runs on every `npm run lint`
      (verified against a deliberately planted violation)
- [x] `npx tsc --noEmit` exits 0 · all TS suites green (165 tests)
- [x] M1 closed — `create` returns `PaymentIntent` only; no `SettleReceipt`
      without a consumed `Coin`; `AnchorWitness` enforces a single consumer
- [x] M3 closed in `splash_custody` — `deposit` is AdminCap-gated and emits
      `PoolFunded`; batch paths carry the owner binding
- [x] `'splash-my'` absent from settlement paths
- [x] `money-path.ts` free of Hata; `splashIsParty` on every step, asserted
- [ ] **`AdminCap` and `AttestationCap` at different addresses** — cannot be
      verified from the repo. Run against the live wallet before publish; if
      they share an address this is **blocking**.
- [x] `UpgradeCap` decision made: **immutable core** (below)
- [ ] Independent Move review commissioned — deck slide 6 commits to this
- [ ] `splash_core` published; package ID + object IDs here and in `.env`
- [ ] One end-to-end mainnet settlement executed; digest recorded
- [x] `SECURITY.md` updated

---

## Upgrade policy — `splash_core` publishes IMMUTABLE

The `UpgradeCap` is burned at publish. No upgrade path exists.

**Why.** A settlement contract whose logic *cannot* change is a stronger
regulatory position than one under multisig: with multisig the question becomes
"who controls the keys, and what stops them rewriting the contract?", and the
answer is a custody procedure an auditor has to take on trust. Immutable makes
the question disappear. The package split is what makes this affordable — core
is six modules with no third-party dependencies, small enough to review
exhaustively.

**What this costs, stated plainly.** A bug found after publish cannot be
patched. It requires a fresh publish and a re-bootstrap of every shared object,
and the old package keeps running until clients are repointed. That is the
trade, accepted deliberately. It raises the stakes on the independent review,
which is why that gate above is not optional.

The precedent is good: the current testnet package `0xec3b063e…` was published
immutable on 2026-07-19 and the re-bootstrap path is exercised
(`docs/KEY-CEREMONY-RUNBOOK.md`).

---

## Phase 0 vs Phase 1 — what the server does

`SPLASH_CORE_PACKAGE_ID` is **required**. `SPLASH_CUSTODY_PACKAGE_ID` is
**absent in Phase 0**, and any code path needing custody fails with:

> Batch settlement requires the splash_custody package, which publishes when the
> Labuan e-money licence is granted. Phase 0 uses payment_intent
> (non-custodial). See STATUS.md.

The error names the licence rather than reporting a missing environment
variable, because "not configured" reads as a deployment mistake when it is
actually the regulatory posture working correctly.

---

## Out of scope for mainnet, scheduled immediately after

**Event privacy.** Every event publishes sender, recipient, amount, corridor and
fee in cleartext, and B2B counterparties use stable addresses. This does not
block mainnet. It **does** block the anchor buyer — no exporter puts their
supplier list on a public chain.

**Open items from the 2026-08-13 adversarial pass** (`SECURITY.md`, A-11..A-19)
— chiefly A-11 (no amount cap or velocity limit on any `AdminCap` function) and
A-12 (the S-10 cap split is written but not yet in effect at runtime). Both are
custody-side and land with the Phase 1 publish, but A-12 is an operational
change that should happen at the September ceremony regardless.
