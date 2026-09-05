/**
 * The one way to read or write a transfer.
 *
 * Two backends, one API. Postgres when `DATABASE_URL` is configured — which is
 * every deployed environment, since `lib/env.ts` requires it for authority and
 * persistence — and the in-process map only when it is not, which is local
 * development and CI.
 *
 * ─── Why the fallback is narrow, and says so ────────────────────────────────
 *
 * The in-memory store is not a cache and not a mode anyone should choose. It
 * exists so `npm run dev` works without a database, and it announces itself
 * once per process so nobody mistakes a working demo for a working deployment.
 * It is NOT a fallback for a database that is configured but unreachable: that
 * case must fail, because silently continuing into a store that forgets
 * everything is how a settled payment stops existing.
 *
 * ─── Every read is scoped ───────────────────────────────────────────────────
 *
 * `orgId` is the first argument of every read, and it is not optional. The
 * record this replaces had no org id at all: one global map, every tenant, no
 * scoping — `listTransfers()` returned everybody's. That was a tenant-isolation
 * bug hidden by there being one tenant.
 *
 * Cross-tenant reach exists for the staff console and is spelled `*ForStaff`,
 * so granting it is a visible act at the call site rather than an argument
 * somebody forgot to pass.
 */
import { operations, type TransferIntentRecord } from './operations.ts';
import * as repo from './repository/transfers.ts';

let announced = false;

function usingPostgres(): boolean {
  if (process.env.DATABASE_URL) return true;
  if (!announced) {
    announced = true;
    console.warn(
      '[transfers] DATABASE_URL is not set, so transfers live in this process and ' +
        'disappear when it restarts. Local development only — every deployed ' +
        'environment requires it.',
    );
  }
  return false;
}

async function db() {
  const { getDb } = await import('../db/client.ts');
  return getDb() as never;
}

/** Repository row -> the record shape every caller already uses. */
function toRecord(row: repo.TransferRow): TransferIntentRecord {
  return {
    ...(row.metadata as Partial<TransferIntentRecord>),
    id: row.id,
    orgId: row.orgId,
    state: row.state as TransferIntentRecord['state'],
    recipientName: row.recipientName,
    targetCurrency: row.targetCurrency,
    targetAmount: row.targetAmount,
    sourceAmountUsd: row.sourceAmountUsd,
    quoteId: row.quoteId,
    exchangeRate: row.exchangeRate,
    deliveryTier: row.deliveryTier as TransferIntentRecord['deliveryTier'],
    recipientId: row.recipientId,
    invoiceId: row.invoiceId,
    suiTxDigest: row.suiTxDigest,
    receiptObjectId: row.receiptObjectId,
    walrusBlobId: row.walrusBlobId,
    auditAnchorId: row.auditAnchorId,
    failureReason: row.failureReason,
    failedAtState: row.failedAtState,
    demo: row.demo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as TransferIntentRecord;
}

/**
 * The fields with a column of their own. Everything else on the record is one
 * settlement's own detail and rides in `settlement_metadata` — see the
 * migration for why that is one jsonb rather than twenty sparse columns.
 */
const COLUMN_FIELDS = new Set([
  'id', 'orgId', 'state', 'recipientName', 'targetCurrency', 'targetAmount',
  'sourceAmountUsd', 'quoteId', 'exchangeRate', 'deliveryTier', 'recipientId',
  'invoiceId', 'suiTxDigest', 'receiptObjectId', 'walrusBlobId', 'auditAnchorId',
  'failureReason', 'failedAtState', 'demo', 'createdAt', 'updatedAt',
]);

function splitMetadata(record: Partial<TransferIntentRecord>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!COLUMN_FIELDS.has(key) && value !== undefined) metadata[key] = value;
  }
  return metadata;
}

export async function persistTransfer(record: TransferIntentRecord): Promise<TransferIntentRecord> {
  if (!usingPostgres()) {
    operations.transfers.set(record.id, record);
    return record;
  }
  const row = await repo.insertTransfer(await db(), {
    id: record.id,
    orgId: record.orgId,
    state: record.state,
    recipientName: record.recipientName,
    targetCurrency: record.targetCurrency,
    targetAmount: record.targetAmount,
    sourceAmountUsd: record.sourceAmountUsd,
    quoteId: record.quoteId,
    exchangeRate: record.exchangeRate,
    deliveryTier: record.deliveryTier,
    recipientId: record.recipientId,
    invoiceId: record.invoiceId,
    suiTxDigest: record.suiTxDigest,
    receiptObjectId: record.receiptObjectId,
    walrusBlobId: record.walrusBlobId,
    auditAnchorId: record.auditAnchorId,
    failureReason: record.failureReason,
    failedAtState: record.failedAtState,
    demo: record.demo,
    metadata: splitMetadata(record),
  });
  return toRecord(row);
}

/** Read one transfer belonging to `orgId`. A foreign id reads as missing. */
export async function readTransfer(
  orgId: string,
  intentId: string,
): Promise<TransferIntentRecord | null> {
  if (!usingPostgres()) {
    const record = operations.transfers.get(intentId) ?? null;
    return record && record.orgId === orgId ? record : null;
  }
  const row = await repo.getTransfer(await db(), orgId, intentId);
  return row ? toRecord(row) : null;
}

/** Cross-tenant read. Staff console and internal settlement callbacks only. */
export async function readTransferForStaff(
  intentId: string,
): Promise<TransferIntentRecord | null> {
  if (!usingPostgres()) return operations.transfers.get(intentId) ?? null;
  const row = await repo.getTransferForStaff(await db(), intentId);
  return row ? toRecord(row) : null;
}

export async function listTransfersFor(orgId: string, limit = 100): Promise<TransferIntentRecord[]> {
  if (!usingPostgres()) {
    return [...operations.transfers.values()]
      .filter((t) => t.orgId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const rows = await repo.listTransfers(await db(), orgId, limit);
  return rows.map(toRecord);
}

/** Every transfer, for the staff console. Named so it cannot be reached by accident. */
export async function listTransfersForStaff(limit = 200): Promise<TransferIntentRecord[]> {
  if (!usingPostgres()) {
    return [...operations.transfers.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const rows = await repo.listAllTransfers(await db(), limit);
  return rows.map(toRecord);
}

/**
 * Keep the audit receipt in step with the transfer.
 *
 * `updateTransferIntent` carried this as a side effect, and deleting it froze
 * every transfer's status history at AUTHORIZED — the customer's tracker in
 * `components/transfer/StepStatus.tsx` reads that history for its stage
 * timestamps, so the payment would have kept moving while the page showed it
 * stuck at the first step.
 *
 * The durable record of a transition is the `intent_transitions` row the
 * repository writes. This mirrors it into the receipt store, which has not
 * moved to Postgres yet; when it does, this goes and the history is read back
 * from those rows instead.
 *
 * Idempotent by construction: it appends only when the recorded head differs,
 * so a retried patch does not log the same state twice.
 */
function mirrorToAuditReceipt(intentId: string, patch: Partial<TransferIntentRecord>): void {
  const receipt = operations.auditReceipts.get(intentId) ?? {
    transferIntentId: intentId,
    statusHistory: [],
  };
  if (patch.state && patch.state !== receipt.statusHistory.at(-1)?.state) {
    receipt.statusHistory.push({ state: patch.state, at: new Date().toISOString() });
  }
  if (patch.suiTxDigest) receipt.suiTxDigest = patch.suiTxDigest;
  if (patch.sweepJobId) receipt.sweepJobId = patch.sweepJobId;
  operations.auditReceipts.set(intentId, receipt);
}

export async function patchTransfer(
  intentId: string,
  patch: Partial<TransferIntentRecord>,
  actor?: string,
): Promise<void> {
  if (!usingPostgres()) {
    const record = operations.transfers.get(intentId);
    if (!record) return;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    operations.transfers.set(intentId, record);
    mirrorToAuditReceipt(intentId, patch);
    return;
  }
  const metadata = splitMetadata(patch);
  const row = await repo.patchTransfer(
    await db(),
    intentId,
    {
      state: patch.state,
      suiTxDigest: patch.suiTxDigest,
      receiptObjectId: patch.receiptObjectId,
      walrusBlobId: patch.walrusBlobId,
      auditAnchorId: patch.auditAnchorId,
      failureReason: patch.failureReason,
      failedAtState: patch.failedAtState,
      recipientId: patch.recipientId,
      invoiceId: patch.invoiceId,
      exchangeRate: patch.exchangeRate,
      targetAmount: patch.targetAmount,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
    actor,
  );
  // Only after the write landed. A patch against an id that does not exist
  // must not leave a history entry for a transfer nobody has.
  if (row) mirrorToAuditReceipt(intentId, patch);
}

export async function findTransferByIdempotencyKey(
  orgId: string,
  key: string,
): Promise<TransferIntentRecord | null> {
  if (!usingPostgres()) {
    const hit = [...operations.transfers.values()].find(
      (t) => t.orgId === orgId && (t as { idempotencyKey?: string }).idempotencyKey === key,
    );
    return hit ?? null;
  }
  const row = await repo.findByIdempotencyKey(await db(), orgId, key);
  return row ? toRecord(row) : null;
}
