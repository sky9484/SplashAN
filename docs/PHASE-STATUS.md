# Build phases — what is done, and what is not

Tracks `SPLASH-BUILD-LIST.md` / `SPLASH-CLAUDE-CODE-PROMPT.md`.
Companion to `STATUS.md`, which covers the mainnet cutover specifically.

**Branch:** `feat/phase5-passkey-authority` — contains Phases 0–5 in order, 14
commits off `main`. Each phase is one or more commits with its reasoning in the
message; nothing is squashed.

---

## Done

| Phase | What landed |
|---|---|
| **0 · Reproducibility** | `lib/env.ts` (147-key zod contract, validated at boot), `scripts/check-env-reads.mjs` in lint, Seal config → `config/seal.<env>.json`, `npm run doctor`, `GET /api/health`, Node 24 + npm 11 pinned with `engine-strict`, `setup-sui-pilot` ported to Node, `xlsx` (vendor CDN) → `read-excel-file` |
| **1 · Claims defects** | `PARTNER_ROWS` deleted — `/trust` states roles, not unsigned counterparties; the 2-of-3 claim corrected; `labuanApplication` now `not-licensed` and falsifiable; every MFCA "licence held" claim removed, including the README and the invariant checker's own error text |
| **2 · Money arithmetic** | `lib/money.ts` — bigint minor units, scaled-integer rates, explicit rounding. All 17 `W2` float-math sites migrated; the rule is a **hard build failure** now |
| **3 · Real users** | `users` split from `memberships` (no default role), scrypt password hashing, `createSignupSession` deleted, `resolveAuthorityForSession` fails closed, login rate limiting in Postgres, env credential pair removed |
| **4 · zkLogin UI** | "Continue with Google", `max_epoch` +1/+2 rule computed server-side, 15-minute idle timeout independent of `max_epoch`, callback keeps the token out of URL and history |
| **5 · Passkey authority** | SIP-9 enrolment at `/settings/security`, public key captured at creation and persisted, signature/sender/canon-hash verification, one active credential per origin |
| **Membership admin** (not a numbered phase) | `/admin/memberships` — the operator surface for the grant Phase 3 removed. One grant path, no default role, no account creation from the form, and the two money-moving roles say so at the point of granting. `scripts/dev-db.mjs` runs it locally without a cluster |

**304 tests across eleven suites**, plus 36 Move tests that run on the CLI
installed here (14 `splash_core` + 22 `splash_meter`). Lint, `tsc` and the production build are clean.

---

## Not done

### Phase 6 · Move authority — not started

Blocked on three things, in this order:

1. **The Sui CLI on this machine is 1.75.1, not the 1.77.2 the Move work was
   verified on.** The binary is at `%LOCALAPPDATA%\bin\sui.exe` (not on PATH
   by default). All three packages BUILD clean on it, and
   `sui move test` is green for `splash_core` (**14/14**) and `splash_meter`
   (**22/22**) — both have no dependencies. `splash_custody` fails **0/16**,
   every test identically:

   ```
   VMError { major_status: MISSING_DEPENDENCY,
             location: Module(0x2::object), indices: [(FunctionHandle, 2)] }
   ```

   A whole-package linkage failure before any assertion runs, in the only
   package with git dependencies (DeepBook `daa5a951`, OpenZeppelin math) —
   and its own `Move.toml` records that the pin moved forward only once the
   CLI reached 1.77.2. `STATUS.md`'s mainnet gate claims 16/16 for custody;
   that claim is not falsified, but it is **not reproducible here today**, and
   a gate item that cannot be re-run is not a gate. Restore 1.77.2 first.

2. **Sebastian confirms.** Protocol: Move changes are not self-approved.
3. **`move/splash_core/Move.toml` has an empty `[dependencies]` block** — no
   pinned Sui framework, so whichever CLI is installed silently defines the
   toolchain. Worth pinning explicitly whether or not Phase 6 proceeds.

Scope, unchanged from the brief: delete `mint_attestation_cap`
(`business_account.move:149` — it lets Splash mint a capability to an arbitrary
address, the inverse of canon); add `owners` / `approvers` / `frozen` /
`recovery_party`; revocation that kills in-flight approvals including
revoke-then-regrant; the 24h / USD 1,000 velocity cap; `ComplianceCap`
subtractive **by type**, with a CI check greping every `&ComplianceCap`
signature; the `TreasuryCap` / `AnchorCap` / `ComplianceCap` / `AdminCap` split;
then the adversarial pass in §7 of the build list.

### Phase 7 · Break-glass — not started

Depends on Phase 6.

---

## Configuration still outstanding

`.env.local` does not exist on this machine, so nothing is configured. Secrets
belong in that file and must never be pasted into a chat or committed.

| Key | Who | Note |
|---|---|---|
| `DATABASE_URL` | you, in `.env.local` | Phases 3–5 need it; auth and passkeys are Postgres-backed |
| `ENOKI_API_KEY` | you, in `.env.local` | Sponsorship. Nothing calls Enoki yet except the health probe |
| `SPLASH_PACKAGE_ID` | public — can be committed | `npm run doctor` fails on this today |
| `SUI_NETWORK` | public | `testnet` until a mainnet package exists |
| Seal committee | public — goes in `config/seal.production.json` | Object ids, aggregator URLs, weights, threshold, package + policy ids |
| `ZKLOGIN_GOOGLE_CLIENT_ID` | public | **Part of zkLogin address derivation.** One per environment, never rotated after users exist |
| `PASSKEY_RP_ID` | public | **See the warning below** |

### `PASSKEY_RP_ID` is the one that becomes unfixable

Unset, it falls back to `NEXT_PUBLIC_APP_URL`'s hostname. The moment anyone
enrols a passkey on production, that value is frozen: a WebAuthn credential is
scoped to its rpId and the browser will not offer it on any other host, so
changing it orphans every existing credential with no migration path.

If one passkey should work across `splashz.xyz` **and** `v1.splashz.xyz`, the
rpId must be the parent domain — and that cannot be decided retroactively.

---

## Deploy order — three things that will cause an outage if done singly

These are not Phase 6 blockers. They bite the first time this branch is
deployed.

1. **Seal: the file and the env var must land in the same deploy.**
   Production refuses to boot without `config/seal.production.json`, *and*
   refuses if `SEAL_KEY_SERVER_ENDPOINTS` (or any of the six other moved keys)
   is still set on the host. Both, together, or neither.

2. **Remove `CUSTOMER_EMAIL` and `CUSTOMER_PASSWORD` from the host.**
   Phase 3 deleted that login path and both keys are declared must-be-unset, so
   a leftover value fails boot by name. Deliberate: a password in a file that
   governs nothing still reads as a control.

3. **Migrations `0004` and `0005` have never run against real Postgres** —
   only PGlite, in tests. `0004` is the risky one: hand-written, because
   drizzle-kit needed a TTY to resolve whether `org_id` was renamed or dropped,
   and it **moves data** (existing users' org and role into `memberships`)
   before dropping those columns. Run it against a restored copy first.

### And nobody can log in until a membership is granted

Existing `users` rows have no `password_hash`, so no previous credential works.
The first real account is created through `/api/auth/signup` — which grants
nothing by design — and then needs a membership.

**The screen for that now exists**: `/admin/memberships` in the staff console.
It calls the same `grantMembership()` and nothing else can create a membership
(a test asserts `lib/server/memberships.ts` contains no `.insert(` of its own).
It refuses to grant to an address with no account, has no default role, and
names in plain words which roles release money. Revoking is a hard delete —
a membership is current authority, not evidence.

So the first-operator sequence is: sign up → a staff member grants the
membership → the account can act. Nothing about it is implicit.

---

## Known gaps that are nobody's phase

- **`npm run test:seal:integration` has never been run here.** It needs
  `.env.local` credentials and live network access.
- **Two pre-existing eslint warnings** — `SPLASH_BUSINESS_ACCOUNT_ID` and
  `getTreasuryRate`, both unused. Predate this work; left alone deliberately.
- **`docs/` and `experiments/` are published in the public `SplashAN` repo.**
  Every unsigned counterparty was de-named, so nothing false or attributable is
  public, but the mainnet checklist, the key-ceremony runbook and the deployment
  topology are readable by anyone.
- **`SplashAN` has no LICENSE file.** Public with no licence means all rights
  reserved by default — possibly what you want, but currently a default rather
  than a decision.
- **`SplashAN` is one squashed commit** and does not carry Phases 2–5. It is a
  showcase, not a mirror.
