/**
 * The one way to read or write the ledger.
 *
 * Same two-backend shape as `transfers-store.ts`: Postgres when `DATABASE_URL`
 * is configured, the in-process map only when it is not.
 *
 * ─── What this replaces ─────────────────────────────────────────────────────
 *
 * `createLedgerEntry` appended a single row to a `Map` on `globalThis`, and
 * `getLedgerBalance` summed it. That balance is what
 * `app/api/transfers/authorize/route.ts` checks before letting a payment leave
 * — "Splash balance is insufficient for this payment source" — so the gate on
 * every held-balance payment was a number computed from a store that emptied on
 * restart. After a deploy, every account read as zero; before one, an account
 * could be debited twice across two processes that never saw each other's
 * writes.
 *
 * Meanwhile `lib/ledger/post.ts` — the double-entry writer with the balance
 * invariant, the test suite and the paragraph in docs/W1-BACKUPS.md — was
 * called by nothing but its own test.
 *
 * Every movement now goes through `postJournal` as a balanced pair, and the
 * balance is a SUM over `ledger_postings`.
 *
 * ─── Amounts are bigint here ────────────────────────────────────────────────
 *
 * The in-memory record used a JS `number` for micro-USDC. Callers that still
 * hold a number convert at the boundary, explicitly, rather than relying on a
 * coercion — mixing the two silently is how a balance check passes on a figure
 * the ledger does not hold.
 */
import type { LedgerEntry } from './operations.ts';
import * as repo from './repository/ledger.ts';

let announced = false;

function usingPostgres(): boolean {
  if (process.env.DATABASE_URL) return true;
  if (!announced) {
    announced = true;
    console.warn(
      '[ledger] DATABASE_URL is not set, so the ledger lives in this process and ' +
        'disappears when it restarts. Local development only.',
    );
  }
  return false;
}

async function db() {
  const { getDb } = await import('../db/client.ts');
  return getDb();
}

export type LedgerMovement = {
  accountId: string;
  direction: 'CREDIT' | 'DEBIT';
  amountMinor: bigint;
  refType: LedgerEntry['refType'];
  refId: string;
  /** Known at the authorize and sweep sites, not at the funding webhook. The
   *  account id is the scoping key either way. */
  orgId?: string | null;
  suiTxDigest?: string;
  demo?: boolean;
};

export type LedgerLine = {
  id: string;
  accountId: string;
  direction: 'CREDIT' | 'DEBIT';
  amountMinor: bigint;
  balanceAfterMinor: bigint;
  refType: string;
  refId: string;
  suiTxDigest?: string;
  createdAt: string;
};

function fromMemory(entry: LedgerEntry): LedgerLine {
  return {
    id: entry.id,
    accountId: entry.accountId,
    direction: entry.direction,
    amountMinor: entry.amountUsdcMicro,
    balanceAfterMinor: entry.balanceAfterMicro,
    refType: entry.refType,
    refId: entry.refId,
    suiTxDigest: entry.suiTxDigest,
    createdAt: entry.createdAt,
  };
}

/** Record one movement. On Postgres this is a balanced double-entry journal. */
export async function recordMovement(movement: LedgerMovement): Promise<LedgerLine> {
  if (!usingPostgres()) {
    const { createLedgerEntry } = await import('./operations.ts');
    return fromMemory(
      createLedgerEntry({
        accountId: movement.accountId,
        direction: movement.direction,
        amountUsdcMicro: movement.amountMinor,
        refType: movement.refType,
        refId: movement.refId,
        suiTxDigest: movement.suiTxDigest,
        demo: movement.demo,
      }),
    );
  }
  return repo.recordEntry(await db(), {
    accountId: movement.accountId,
    direction: movement.direction,
    amountMinor: movement.amountMinor,
    refType: movement.refType,
    refId: movement.refId,
    orgId: movement.orgId ?? null,
    suiTxDigest: movement.suiTxDigest,
  });
}

/**
 * What this account may spend, in minor units.
 *
 * Scoped by account id, which is the tenant key: it is resolved from the
 * session by `requireSessionAccount` and never accepted from a request — see
 * the `isForeignAccountId` guard at every call site that takes one.
 */
export async function accountBalance(accountId: string): Promise<bigint> {
  if (!usingPostgres()) {
    const { getLedgerBalance } = await import('./operations.ts');
    return getLedgerBalance(accountId);
  }
  return repo.accountBalanceMinor(await db(), accountId);
}

/**
 * One account's movements since a moment — every one of them, unpaged.
 *
 * This feeds the daily-spend ceiling in `lib/policy/authorization-limits.ts`.
 * A paged read there would be a ceiling that stops binding on a busy account.
 */
export async function listMovementsSince(
  accountId: string,
  sinceMs: number,
): Promise<LedgerLine[]> {
  if (!usingPostgres()) {
    const { listLedgerEntries } = await import('./operations.ts');
    return listLedgerEntries(accountId)
      .filter((entry) => Date.parse(entry.createdAt) >= sinceMs)
      .map(fromMemory);
  }
  return repo.listEntriesSince(await db(), accountId, sinceMs);
}

/** One account's movements, newest first. */
export async function listMovements(accountId: string, limit = 100): Promise<LedgerLine[]> {
  if (!usingPostgres()) {
    const { listLedgerEntries } = await import('./operations.ts');
    return listLedgerEntries(accountId).slice(0, limit).map(fromMemory);
  }
  return repo.listEntriesFor(await db(), accountId, limit);
}
