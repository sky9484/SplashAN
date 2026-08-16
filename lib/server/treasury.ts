/**
 * Smart Treasury — two-bucket model with OFF-CHAIN per-user accounting.
 *
 *   Available balance  → USDC, 0% yield, instant. Operating cash for payments.
 *   Smart Treasury     → Ondo USDY, floating ~net APY, T+1–T+3 withdrawal notice.
 *
 * On-chain we hold two omnibus `SmartTreasury<T>` pools (USDC + USDY); this
 * ledger is the source of truth for individual user claims. Reconcile daily and
 * anchor the snapshot to Walrus via audit_anchor.move.
 *
 * Invariants (checked daily):
 *   Σ(available)               == USDC pool value
 *   Σ(principal + yield)       == USDY pool units × redemption price
 *
 * Amounts are micro-USD (1 USD = 1_000_000), kept as JS numbers (safe to ~$9B).
 * No per-user on-chain objects — omnibus + this ledger only.
 */

import { getTreasuryRate, getUsdyRedemptionPrice, quoteSwap } from './usdy';

export type UserTreasuryLedger = {
  userId: string;
  availableMicro: number; // USDC, 0%, instant
  treasuryPrincipalMicro: number; // USDC-equivalent moved into USDY
  treasuryYieldMicro: number; // accrued, unredeemed yield
  updatedAt: string;
};

export type WithdrawalNoticeState = 'PENDING' | 'SWAPPING' | 'SETTLED' | 'CANCELLED';

export type WithdrawalNotice = {
  id: string;
  userId: string;
  amountMicro: number;
  requestedAt: string;
  /** When the funds land back in Available (T+1–T+3). */
  availableAt: string;
  state: WithdrawalNoticeState;
};

export type YieldSnapshot = {
  date: string;
  redemptionPriceUsd: number;
  netApyPct: number;
  totalTreasuryMicro: number;
  yieldDistributedMicro: number;
  spreadToOperatingMicro: number;
};

// ─── In-memory store (demo). Swap for a DB + omnibus reconciliation in prod. ────

const ledgers = new Map<string, UserTreasuryLedger>();
const notices: WithdrawalNotice[] = [];
let noticeCounter = 0;

const DEMO_USER = 'demo-business';
function seedDemo(): UserTreasuryLedger {
  const existing = ledgers.get(DEMO_USER);
  if (existing) return existing;
  const seeded: UserTreasuryLedger = {
    userId: DEMO_USER,
    availableMicro: 11_140_000_000, // $11,140 operating (matches Overview)
    treasuryPrincipalMicro: 24_500_000_000, // $24,500 in Smart Treasury
    treasuryYieldMicro: 98_720_000, // $98.72 accrued
    updatedAt: new Date().toISOString(),
  };
  ledgers.set(DEMO_USER, seeded);
  return seeded;
}

export function getLedger(userId: string = DEMO_USER): UserTreasuryLedger {
  return ledgers.get(userId) ?? seedDemo();
}

export function listLedgers(): UserTreasuryLedger[] {
  if (ledgers.size === 0) seedDemo();
  return [...ledgers.values()];
}

// Notice window in business days. USDY is short-dated-T-bill backed, so this is
// a fast, liquid window by design (working capital, not a lock-up). Bounded to
// [1, 10] business days: 1–2 is the realistic headline, up to 5 (one business
// week) is a defensible liquidity-management buffer; longer is discouraged.
const NOTICE_DAYS_MAX = 10;

export function noticeWindowDays(): number {
  const n = Number(process.env.USDY_WITHDRAWAL_DAYS ?? 2);
  return Math.min(NOTICE_DAYS_MAX, Math.max(1, Number.isFinite(n) ? Math.round(n) : 2));
}

/** Single source of truth for withdrawal-window copy — UI never hardcodes it. */
export function noticeWindowLabel(): string {
  const n = noticeWindowDays();
  return n === 1 ? 'next business day' : `1–${n} business days`;
}

/** Add N business days (skip Sat/Sun) — the T+1–T+3 settlement window. */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

// ─── Moves ──────────────────────────────────────────────────────────────────

/** Available (USDC) → Smart Treasury (USDY). Quotes a guarded USDC→USDY swap. */
export async function moveToTreasury(userId: string, amountMicro: number) {
  const ledger = getLedger(userId);
  if (amountMicro <= 0) throw new Error('amount must be positive');
  if (amountMicro > ledger.availableMicro) throw new Error('insufficient available balance');
  const swap = await quoteSwap('usdc->usdy', BigInt(amountMicro));
  ledger.availableMicro -= amountMicro;
  ledger.treasuryPrincipalMicro += amountMicro;
  ledger.updatedAt = new Date().toISOString();
  return { ledger, swap };
}

/**
 * Smart Treasury → Available requires a withdrawal NOTICE (T+1–T+3). Funds are
 * reserved now; the USDY→USDC swap + credit happen on settle.
 */
export function requestTreasuryWithdrawal(userId: string, amountMicro: number): WithdrawalNotice {
  const ledger = getLedger(userId);
  const redeemable = ledger.treasuryPrincipalMicro + ledger.treasuryYieldMicro;
  if (amountMicro <= 0) throw new Error('amount must be positive');
  if (amountMicro > redeemable) throw new Error('insufficient treasury balance');
  const now = new Date();
  const notice: WithdrawalNotice = {
    id: `wn_${Date.now()}_${++noticeCounter}`,
    userId,
    amountMicro,
    requestedAt: now.toISOString(),
    availableAt: addBusinessDays(now, noticeWindowDays()).toISOString(),
    state: 'PENDING',
  };
  // Reserve against principal first, then accrued yield.
  const fromPrincipal = Math.min(amountMicro, ledger.treasuryPrincipalMicro);
  ledger.treasuryPrincipalMicro -= fromPrincipal;
  ledger.treasuryYieldMicro -= amountMicro - fromPrincipal;
  ledger.updatedAt = now.toISOString();
  notices.push(notice);
  return notice;
}

/** On settlement: swap USDY→USDC (guarded) and credit Available. */
export async function settleWithdrawal(noticeId: string) {
  const notice = notices.find((n) => n.id === noticeId);
  if (!notice) throw new Error('notice not found');
  if (notice.state === 'SETTLED') return notice;
  if (notice.state === 'CANCELLED') throw new Error('withdrawal was cancelled');
  notice.state = 'SWAPPING';
  await quoteSwap('usdy->usdc', BigInt(notice.amountMicro));
  const ledger = getLedger(notice.userId);
  ledger.availableMicro += notice.amountMicro;
  ledger.updatedAt = new Date().toISOString();
  notice.state = 'SETTLED';
  return notice;
}

/**
 * Settle every PENDING notice whose window has elapsed (availableAt ≤ now). This
 * is what actually credits Available on schedule — call it from the
 * settle-withdrawals cron. `force` settles all PENDING regardless of date and is
 * demo-only (used to fast-forward the T+N window without waiting real days).
 */
export async function settleDueWithdrawals(opts: { force?: boolean } = {}): Promise<WithdrawalNotice[]> {
  const now = Date.now();
  const due = notices.filter(
    (n) => n.state === 'PENDING' && (opts.force === true || new Date(n.availableAt).getTime() <= now),
  );
  const settled: WithdrawalNotice[] = [];
  for (const n of due) settled.push(await settleWithdrawal(n.id));
  return settled;
}

/**
 * Cancel a still-pending withdrawal and return the reserved funds to Treasury.
 * Completes the notice state machine (PENDING → CANCELLED).
 */
/**
 * Cancel a pending withdrawal notice.
 *
 * `userId` is REQUIRED and checked against the notice's owner. It used to be
 * absent: any caller who had seen an id (they are handed out by the snapshot
 * endpoint) could cancel any other tenant's withdrawal. Harmless while every
 * caller resolves to the same demo ledger, and a cross-tenant write the moment
 * ledgers are keyed per user — which is exactly the kind of latent hole that
 * gets missed during the migration that introduces it.
 */
export function cancelTreasuryWithdrawal(noticeId: string, userId: string): WithdrawalNotice {
  const notice = notices.find((n) => n.id === noticeId);
  // Same error for "does not exist" and "belongs to someone else" — otherwise
  // the response distinguishes them and the endpoint becomes an id oracle.
  if (!notice || notice.userId !== userId) throw new Error('notice not found');
  if (notice.state !== 'PENDING') throw new Error(`cannot cancel a ${notice.state} withdrawal`);
  const ledger = getLedger(notice.userId);
  ledger.treasuryPrincipalMicro += notice.amountMicro; // un-reserve
  ledger.updatedAt = new Date().toISOString();
  notice.state = 'CANCELLED';
  return notice;
}

export function listNotices(userId?: string): WithdrawalNotice[] {
  return userId ? notices.filter((n) => n.userId === userId) : [...notices];
}

// ─── Daily yield accrual (called by the accrue-yield cron) ──────────────────────

/**
 * Allocate the floating net yield across all treasury balances pro-rata on the
 * end-of-day principal. Returns a snapshot to anchor on Walrus.
 */
export async function accrueDailyYield(): Promise<YieldSnapshot> {
  const rate = getTreasuryRate();
  const { priceUsd } = await getUsdyRedemptionPrice();
  const dailyFactor = rate.netApyPct / 100 / 365;
  let distributed = 0;
  for (const ledger of listLedgers()) {
    const dayYield = Math.floor(ledger.treasuryPrincipalMicro * dailyFactor);
    ledger.treasuryYieldMicro += dayYield;
    ledger.updatedAt = new Date().toISOString();
    distributed += dayYield;
  }
  // Disclosed spread retained by operating (illustrative: 0.5% of gross).
  const spread = Math.floor(distributed * 0.005);
  const total = listLedgers().reduce((s, l) => s + l.treasuryPrincipalMicro, 0);
  return {
    date: new Date().toISOString().slice(0, 10),
    redemptionPriceUsd: priceUsd,
    netApyPct: rate.netApyPct,
    totalTreasuryMicro: total,
    yieldDistributedMicro: distributed,
    spreadToOperatingMicro: spread,
  };
}

// ─── Invariants (daily reconciliation) ──────────────────────────────────────────

export function checkInvariants(poolUsdcMicro: number, poolUsdyUnitsMicro: number, redemptionPriceUsd: number) {
  const sumAvailable = listLedgers().reduce((s, l) => s + l.availableMicro, 0);
  const sumTreasury = listLedgers().reduce((s, l) => s + l.treasuryPrincipalMicro + l.treasuryYieldMicro, 0);
  const usdyValueMicro = Math.round(poolUsdyUnitsMicro * redemptionPriceUsd);
  const availableOk = sumAvailable <= poolUsdcMicro; // pool must cover claims
  const treasuryOk = sumTreasury <= usdyValueMicro;
  return {
    ok: availableOk && treasuryOk,
    sumAvailable,
    poolUsdcMicro,
    sumTreasury,
    usdyValueMicro,
    availableOk,
    treasuryOk,
  };
}
