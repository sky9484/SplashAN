# Splash live demo run sheet

Covers, in order: **1) Transfer · 2) Batch payout · 3) 0xWal · 4) Invoice loop · 5) Treasury.**
Login: `demo@splash.finance` / `Demo@12345`.

---

## Pre-flight (do this 10 min before, once)

Two switches decide how "real" the demo is. Pick per section.

### A. 0xWal AI answers
The Anthropic API key currently has **no credits**, so 0xWal's model calls fail and
fall back to the built-in local planner. 0xWal still **always replies** — scripted
intents (e.g. "do a batch payout") and the local planner cover the demo — but
open-ended AI answers won't be "smart". Two options:

- **Bulletproof demo (recommended):** add `OXWAL_FORCE_LOCAL=true` to `.env.local`.
  0xWal then uses the deterministic planner only — instant, no API dependency, no
  failed-call delay. Every scripted flow below still works.
- **Full AI:** top up credits at the Anthropic console. Then remove
  `OXWAL_FORCE_LOCAL`. Open-ended questions get real Claude answers.

### B. Real on-chain settlement (Transfer + Batch)
Real settlement needs the **current contract object IDs** from the republished
Move package. `.env.local` is missing `SPLASH_COMPLIANCE_CONFIG_ID`,
`DEEPBOOK_POOL_ID`, and `DEEPBOOK_QUOTE_TYPE`, and the IDs that are set may be
stale. So today, Transfer and Batch settlement **fail on-chain** (`SPLASH_COMPLIANCE_CONFIG_ID is not configured`).

- **For real digests + explorer links:** drop your `data/contract-config.json`
  (the file with the republished package's IDs — package, treasury, business
  account, peg state, compliance config, admin cap, deepbook pool + quote type)
  into `data/`. The app hot-reloads it. Requires a funded operator key and a
  liquid testnet DeepBook pool.
- **For a demo that always completes:** set `SUI_SETTLEMENT_MODE=simulate` in
  `.env.local`. Transfer/Batch then finish with a labelled `SIM_` receipt and the
  full UI flow, no on-chain dependency. (Invoice-loop Walrus is **real either way** —
  see §4.)

> **Invoice loop Walrus is already live** — verified this session: uploading an
> invoice produced a real Walrus blob (`mode: live`, 5 epochs). No config needed.

Restart the dev server after any `.env.local` change: `npm run dev`.

---

## 1 · Transfer  (Payments → Transfer)

**Goal:** one payout, USD in → PHP out, quote-locked, audit receipt.

1. Sidebar → **Transfer**.
2. **Beneficiary:** pick 🇵🇭 Philippines. Business name `Acme Manufacturing PH`,
   account `1234567890`. Amount `$500`. → **Continue to delivery**.
3. **Delivery:** choose **Bank payout** (0.80% corridor fee). → **Review quote**.
4. **Quote & Send:** point out the locked rate (≈56.42 PHP), fee ($8.50), recipient
   receives ≈27,730 PHP, 30-second quote hold. Tick the confirm box → **Send**.
5. **Provider deposit:** → **Continue with STRIPE**.
6. **Status:** the settlement steps stream (provider confirmed → Sui settlement →
   PH rail → recipient). 
   - With §B config/simulate: lands on **Receipt** with a digest.
   - Without: it will stop at "Settlement failed" — that's the missing contract
     config, not the UI. Use `SUI_SETTLEMENT_MODE=simulate` to demo the happy path.

**Talking point:** "Funded in USD, delivered in PHP, quote locked at signing, and
every step is an auditable receipt — no bank login ever enters Splash."

---

## 2 · Batch payout  (Payments → Batch Payout)

**Goal:** a payroll/vendor run — screen every row, authorize once.

1. Sidebar → **Batch Payout**.
2. Click **Click to upload CSV** and pick **`public/batch-payout-all-clear.csv`**
   (created for this demo — all 6 rows pass screening).
3. Every row shows **PASS** (AML, KYT amount, structuring, corridor, purpose). The
   summary reads **6 rows cleared, 0 review, 0 blocked**, cleared total ≈ $21,795.
   - Optional contrast: also drop the built-in sample (Download sample) to show
     rows going to **REVIEW/BLOCKED** — proves screening is real.
4. Enter any 6-digit code (e.g. `123456`) → **Authorize**.
5. The batch queues and settles.
   - With §B config/simulate: **SETTLED** with a digest / explorer links.
   - Without: **FAILED** on the missing compliance config (same fix as §1).

**Talking point:** "50 beneficiaries, one signed authorization, one reconciliation
entry — and bad rows are isolated before any value moves."

**CSV file:** `public/batch-payout-all-clear.csv` (also in `samples/`). Columns:
`name,address,country,purpose,amount`. Every amount ≤ $5,000, allowed corridor,
purpose set, distinct names → guaranteed all-PASS.

---

## 3 · 0xWal  (Payments → 0xWal, the default dashboard)

**Goal:** the conversational finance desk that prepares, never executes.

1. Sidebar → **0xWal** (or just land on the dashboard).
2. Type **`do a batch payout`** → 0xWal replies:
   *"I don't see a batch drafted yet — want to create one now?"* with how to start.
   (Deterministic — works regardless of AI credits.)
3. Type **`what can you read and prepare?`** → it lists its read + propose tools.
4. Click the **Review invoice** chip (`Pay invoice inv_demo_acme_5000 to cp_acme_ph`)
   → 0xWal streams activity lines (Reading invoice → Verifying counterparty →
   Preparing payment proposal) and drops an **unsigned Action Card** into the chat
   with impact table, simulation deltas, evidence (trusted/untrusted), and a
   "Approve or reject in the queue" note.
5. Point out the header stats climbing (Proposals / Approval) and the floating
   0xWal badge — it reminds you of pending approvals on any other page.
6. Click **Open queue** → see §3b.

### 3b · 0xWal control room (the Approval queue)

1. The **Approval queue** shows pending proposals with **Approve** / **Reject**.
2. Click **Approve** on a row → it clears to **"Approved & queued for settlement"**
   in *Recently resolved*, the Pending count drops, and a toast confirms. The
   dual-control row needs the second signature — shows the maker-checker split.
3. Click **Reject** on another → confirm dialog → it returns to the maker.

**Talking point:** "0xWal prepares unsigned proposals; a human approves in the
control room. The model never holds authority — approval is enforced outside it."

---

## 4 · Invoice loop  (Finance → Invoices → Inspection loop tab)

**Goal:** private invoice → encrypted proof on Walrus → route recommendation.

1. Sidebar → **Invoices**. Two tabs: **Invoice vault** and **Inspection loop**.
2. Open **Inspection loop**.
3. **Encrypted document:** upload **`samples/invoice-acme-ph-5000.html`** (open it
   first in a browser and "Save as PDF" if you want a PDF — the loop accepts either;
   the file becomes the encrypted Walrus blob). It reads Acme PH, $5,000, due Jun 28.
4. Watch the **release gate** rail fill: Invoice intake → **Walrus proof** (real
   blob id, `mode: live`) → Seal access → 0xWal draft.
5. Click **Extract and recommend route** → shows extracted facts + a route
   recommendation, marked **Approval required**.
6. Click a **Seal access** check — allowed identity passes, `unknown@org` fails closed.
7. **Open payment intent** → hands off to the Transfer flow (§1) with the invoice
   attached.

**Talking point:** "The invoice is Seal-encrypted and its proof is anchored on
Walrus — real, verifiable, 7-year retention — before any money is recommended."

**Files:** `samples/invoice-acme-ph-5000.html` (matches the loop's demo metadata).

---

## 5 · Treasury  (Finance → Treasury)  — brief

**Goal:** idle USD earns a variable T-bill yield; withdrawals are controlled.

1. Sidebar → **Treasury**.
2. Show the **Available (USD, instant, 0%)** vs **Smart Treasury (variable Ondo
   USDY yield)** split, and the projection.
3. Mention withdrawals take 1–3 business days and settlement is approval-gated
   (`TREASURY_EXECUTION_ENABLED=false` today, so this section is read/allocate-only —
   don't attempt a live withdrawal in the demo).

**Talking point:** "Operating cash stays instant; surplus earns a real T-bill-backed
yield, and moving it out is a controlled, auditable action — not a button that
drains the account."

---

## One-line reset between runs
- 0xWal chat / queue state is per-tab — refresh to reset.
- Uploaded invoices persist; that's fine (shows history). Batch/transfer create new
  records each run.
