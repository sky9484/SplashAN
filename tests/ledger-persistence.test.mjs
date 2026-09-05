import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { findUnbalancedJournals } from '../lib/ledger/post.ts';
import * as schema from '../lib/db/schema.ts';
import {
  __testing,
  accountBalanceMinor,
  listEntriesFor,
  listEntriesSince,
  recordEntry,
} from '../lib/server/repository/ledger.ts';

/**
 * The ledger that decides whether a payment may leave.
 *
 * `lib/ledger/post.ts` had the double-entry writer, the balance invariant, a
 * test suite and a paragraph in docs/W1-BACKUPS.md. Nothing called it. Every
 * real money movement went to a single-entry append on a `Map`, and
 * `getLedgerBalance` — the check that gates a held-balance payment — summed
 * that map, so the gate read zero after every restart.
 */

async function migratedDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  await client.exec(`
    INSERT INTO organizations (id, name) VALUES ('acme', 'Acme Trading'), ('northwind', 'Northwind')
  `);
  return { client, db };
}

const USDC = (whole) => BigInt(whole) * 1_000_000n;

// ── The balance a payment is checked against ────────────────────────────────

test('a credit and a debit leave the balance the arithmetic says', async () => {
  const { client, db } = await migratedDb();

  await recordEntry(db, {
    accountId: 'acct_1', orgId: 'acme', direction: 'CREDIT',
    amountMinor: USDC(5000), refType: 'FUNDING', refId: 'fs_1',
  });
  assert.equal(await accountBalanceMinor(db, 'acct_1'), USDC(5000));

  await recordEntry(db, {
    accountId: 'acct_1', orgId: 'acme', direction: 'DEBIT',
    amountMinor: USDC(1800), refType: 'TRANSFER', refId: 'ti_1',
  });
  assert.equal(await accountBalanceMinor(db, 'acct_1'), USDC(3200));
  await client.close();
});

test('the balance survives the process — it is a query, not a map', async () => {
  const { client, db } = await migratedDb();
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'CREDIT', amountMinor: USDC(5000),
    refType: 'FUNDING', refId: 'fs_1',
  });

  // A second handle to the same database: what a restarted process sees. The
  // map this replaces returned 0 here, and the gate on every held-balance
  // payment read that 0 as the truth.
  const other = drizzle(client, { schema });
  assert.equal(await accountBalanceMinor(other, 'acct_1'), USDC(5000));
  await client.close();
});

test('one account’s movements are not another’s', async () => {
  const { client, db } = await migratedDb();
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'CREDIT', amountMinor: USDC(5000),
    refType: 'FUNDING', refId: 'fs_1',
  });
  assert.equal(await accountBalanceMinor(db, 'acct_2'), 0n, 'an unknown account holds nothing');
  await client.close();
});

test('an amount past 2^53 is exact, where a JS number stops being', async () => {
  const { client, db } = await migratedDb();
  // 9,007,199,254.740993 USDC — one micro-unit past Number.MAX_SAFE_INTEGER.
  // The in-memory record held micro-USDC in a `number`, where this figure and
  // the one below it are the same value.
  const past = 9_007_199_254_740_993n;
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'CREDIT', amountMinor: past,
    refType: 'FUNDING', refId: 'fs_1',
  });
  assert.equal(await accountBalanceMinor(db, 'acct_1'), past);
  await client.close();
});

// ── Double entry, which is the point ────────────────────────────────────────

test('every movement is a balanced pair, and the invariant query agrees', async () => {
  const { client, db } = await migratedDb();

  await recordEntry(db, {
    accountId: 'acct_1', orgId: 'acme', direction: 'CREDIT',
    amountMinor: USDC(5000), refType: 'FUNDING', refId: 'fs_1',
  });
  await recordEntry(db, {
    accountId: 'acct_1', orgId: 'acme', direction: 'DEBIT',
    amountMinor: USDC(1800), refType: 'TRANSFER', refId: 'ti_1',
  });
  await recordEntry(db, {
    accountId: 'acct_2', orgId: 'acme', direction: 'CREDIT',
    amountMinor: USDC(1800), refType: 'TRANSFER', refId: 'ti_1',
  });

  assert.deepEqual(
    await findUnbalancedJournals(db),
    [],
    'this is the query docs/W1-BACKUPS.md calls the ledger invariant, and until ' +
      'now nothing the application wrote was subject to it',
  );

  const postings = await client.query('SELECT count(*)::int AS n FROM ledger_postings');
  assert.equal(postings.rows[0].n, 6, 'three movements, two postings each');
  await client.close();
});

test('the customer side and our side are named, not lumped together', async () => {
  const { client, db } = await migratedDb();
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'CREDIT', amountMinor: USDC(5000),
    refType: 'FUNDING', refId: 'fs_1',
  });
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'DEBIT', amountMinor: USDC(1800),
    refType: 'TRANSFER', refId: 'ti_1',
  });

  const rows = await client.query(
    'SELECT account, sum(amount_minor)::text AS total FROM ledger_postings GROUP BY account ORDER BY account',
  );
  assert.deepEqual(
    rows.rows,
    [
      // Negative on the customer's account is money they HOLD: a credit to a
      // liability, per the convention lib/ledger/post.ts states.
      { account: 'account:acct_1', total: '-3200000000' },
      // Our side is the mirror: we hold the 5,000 that arrived, and the 1,800
      // that settled has left.
      { account: 'splash:funding', total: '5000000000' },
      { account: 'splash:transfer', total: '-1800000000' },
    ],
    'funding and settlement are distinguishable without reading refIds',
  );
  assert.equal(__testing.customerAccount('acct_1'), 'account:acct_1');
  assert.equal(__testing.contraAccount('SWEEP'), 'splash:sweep');
  await client.close();
});

// ── What the account holder is shown ────────────────────────────────────────

test('the running balance is walked back from now, so a page is not a lie', async () => {
  const { client, db } = await migratedDb();
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'CREDIT', amountMinor: USDC(5000),
    refType: 'FUNDING', refId: 'fs_1',
  });
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'DEBIT', amountMinor: USDC(1000),
    refType: 'TRANSFER', refId: 'ti_1',
  });
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'DEBIT', amountMinor: USDC(800),
    refType: 'SWEEP', refId: 'sw_1',
  });

  // Only the newest two. Totalled FORWARDS from zero the first row would read
  // -1000, because the oldest row in a page is not the oldest row in the
  // account. Walked backwards from the balance, it reads what it actually was.
  const page = await listEntriesFor(db, 'acct_1', 2);
  assert.equal(page.length, 2);
  assert.equal(page[0].balanceAfterMinor, USDC(3200));
  assert.equal(page[1].balanceAfterMinor, USDC(4000));
  await client.close();
});

test('a movement carries what it refers to, in its own column', async () => {
  const { client, db } = await migratedDb();
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'DEBIT', amountMinor: USDC(800),
    refType: 'SWEEP', refId: 'sweep_job_9', suiTxDigest: '0xabc',
  });

  const [entry] = await listEntriesFor(db, 'acct_1');
  // Before migration 0008 these had nowhere honest to go: the ref would have
  // ridden in `intent_id` (which means an intent) and the digest in
  // `description` (which means prose).
  assert.equal(entry.refId, 'sweep_job_9');
  assert.equal(entry.suiTxDigest, '0xabc');
  assert.equal(entry.refType, 'SWEEP');
  assert.equal(entry.direction, 'DEBIT');
  assert.equal(entry.amountMinor, USDC(800));
  await client.close();
});


// ── The window the daily ceiling is computed over ───────────────────────────

test('the daily window is today’s movements, and it does not page', async () => {
  const { client, db } = await migratedDb();

  // Yesterday's debit, backdated directly: `recordEntry` stamps now.
  await recordEntry(db, {
    accountId: 'acct_1', direction: 'DEBIT', amountMinor: USDC(9000),
    refType: 'TRANSFER', refId: 'ti_old',
  });
  await client.query(
    "UPDATE ledger_postings SET created_at = now() - interval '26 hours'",
  );

  for (let i = 0; i < 5; i += 1) {
    await recordEntry(db, {
      accountId: 'acct_1', direction: 'DEBIT', amountMinor: USDC(100),
      refType: 'TRANSFER', refId: `ti_${i}`,
    });
  }

  const startOfUtcDay = Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
  );
  const today = await listEntriesSince(db, 'acct_1', startOfUtcDay);

  assert.equal(today.length, 5, 'yesterday’s 9,000 does not consume today’s budget');
  assert.equal(
    today.reduce((total, entry) => total + entry.amountMinor, 0n),
    USDC(500),
  );
  // And the query itself is unpaged. A LIMIT here would be a ceiling that
  // stops binding once today's early debits fall off the end of the page —
  // the account would get its daily budget back by being busy.
  const source = await readFile(
    new URL('../lib/server/repository/ledger.ts', import.meta.url),
    'utf8',
  );
  const body = source.slice(source.indexOf('export async function listEntriesSince'));
  assert.doesNotMatch(body, /\.limit\(/, 'the daily window must not be paged');
  await client.close();
});

// ── The wiring itself ───────────────────────────────────────────────────────

test('the application writes through postJournal, not around it', async () => {
  const source = await readFile(
    new URL('../lib/server/repository/ledger.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /postJournal/, 'the audited writer is the only way in');
  assert.doesNotMatch(
    source,
    /insert\(ledgerPostings\)/,
    'a direct posting insert would bypass the balance assertion',
  );

  // Comments stripped first: the claim is that nothing CALLS the in-process
  // ledger, and `app/api/ledger/route.ts` legitimately names `listLedgerEntries`
  // in prose explaining the enumeration bug that route once had.
  const withoutComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  for (const file of [
    '../app/api/transfers/authorize/route.ts',
    '../app/api/batches/authorize/route.ts',
    '../lib/server/sweep.ts',
    '../lib/server/funding-intake.ts',
    '../app/api/ledger/route.ts',
    '../app/api/funding/options/route.ts',
  ]) {
    const text = withoutComments(await readFile(new URL(file, import.meta.url), 'utf8'));
    assert.doesNotMatch(
      text,
      /createLedgerEntry|getLedgerBalance|listLedgerEntries/,
      `${file} still reaches the in-process ledger map directly`,
    );
  }
});
