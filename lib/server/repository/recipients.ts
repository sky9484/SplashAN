/**
 * Beneficiaries, in Postgres, belonging to somebody.
 *
 * `suppliers` was built for this record in migration 0006 — legal identity,
 * address, bank routing scheme, screening verdict, the whole FATF R.16 set —
 * and never wired up. The operational beneficiary lived in a `Map` on
 * `globalThis`, so every field collected to satisfy the travel rule was
 * discarded on restart.
 *
 * The isolation problem was the more urgent one. That Map carried no org id,
 * and both beneficiary routes read it by name or by id alone:
 *
 *   GET /api/recipients         returned EVERY tenant's beneficiaries — names,
 *                               banks, SWIFT codes, account numbers — to any
 *                               authenticated caller. Not one record at a time:
 *                               the whole list, which is the entire PII payload
 *                               a travel-rule record exists to protect.
 *   DELETE /api/recipients/:id  deleted any beneficiary by id, with no check
 *                               that it belonged to the caller. Destructive,
 *                               not merely readable.
 *
 * `suppliers.org_id` is NOT NULL, so scoping here is a property of the table
 * rather than a filter each read has to remember.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { suppliers } from '../../db/schema.ts';
import type * as schemaModule from '../../db/schema.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

export type RecipientRow = {
  id: string;
  orgId: string;
  name: string;
  country: string;
  bank: string;
  swift: string;
  account: string;
  tier: string;
  kybStatus: 'none' | 'lite' | 'full';
  orgEmail?: string;
  createdVia: 'manual' | 'invoice_link';
  sweepConfig?: Record<string, unknown>;
  kybInviteSent?: boolean;
  demo?: boolean;
  createdAt: string;
};

type SupplierSelect = typeof suppliers.$inferSelect;
type SupplierKyb = SupplierSelect['kybStatus'];

/**
 * The record says none/lite/full; the column says none/pending/basic/full/
 * rejected. `lite` is `basic` — the same "we have something, not everything"
 * state under two names, which is what happens when a type and a table are
 * written a year apart. Mapped in one place rather than at each call site.
 */
function toColumnKyb(status: RecipientRow['kybStatus']): SupplierKyb {
  return status === 'lite' ? 'basic' : status;
}

function fromColumnKyb(status: SupplierKyb): RecipientRow['kybStatus'] {
  if (status === 'full') return 'full';
  // `pending`, `basic` and `rejected` all read as `lite` to a record that has
  // only three states. Widening the record's type is a separate change; losing
  // the distinction silently in the other direction would not be.
  return status === 'none' ? 'none' : 'lite';
}

function toRow(row: SupplierSelect): RecipientRow {
  const metadata = (row.recipientMetadata ?? {}) as {
    orgEmail?: string;
    createdVia?: RecipientRow['createdVia'];
    kybInviteSent?: boolean;
  };
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    country: row.country,
    bank: row.bankName ?? '',
    swift: row.swift ?? '',
    account: row.accountRef ?? '',
    tier: row.tier ?? 'PAYOUT_ONLY',
    kybStatus: fromColumnKyb(row.kybStatus),
    orgEmail: metadata.orgEmail,
    createdVia: metadata.createdVia ?? 'manual',
    sweepConfig: (row.sweepConfig ?? undefined) as Record<string, unknown> | undefined,
    kybInviteSent: metadata.kybInviteSent,
    demo: row.demo,
    createdAt: row.createdAt.toISOString(),
  };
}

export type NewRecipient = Omit<RecipientRow, 'createdAt'>;

export async function insertRecipient(db: DrizzleDb, input: NewRecipient): Promise<RecipientRow> {
  const [row] = await db
    .insert(suppliers)
    .values({
      id: input.id,
      orgId: input.orgId,
      name: input.name,
      country: input.country,
      bankName: input.bank || null,
      swift: input.swift || null,
      accountRef: input.account || null,
      kybStatus: toColumnKyb(input.kybStatus),
      tier: input.tier,
      sweepConfig: input.sweepConfig ?? null,
      demo: input.demo ?? false,
      recipientMetadata: {
        orgEmail: input.orgEmail,
        createdVia: input.createdVia,
        kybInviteSent: input.kybInviteSent,
      },
    })
    .returning();
  return toRow(row);
}

/** One beneficiary belonging to `orgId`. A foreign id reads as missing. */
export async function getRecipient(
  db: DrizzleDb,
  orgId: string,
  recipientId: string,
): Promise<RecipientRow | null> {
  const rows = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, recipientId), eq(suppliers.orgId, orgId)))
    .limit(1);
  return rows.length > 0 ? toRow(rows[0]) : null;
}

/** Cross-tenant read. Internal settlement paths, which hold a transfer that
 *  already established the owner, and the public pay page. */
export async function getRecipientForStaff(
  db: DrizzleDb,
  recipientId: string,
): Promise<RecipientRow | null> {
  const rows = await db.select().from(suppliers).where(eq(suppliers.id, recipientId)).limit(1);
  return rows.length > 0 ? toRow(rows[0]) : null;
}

export async function listRecipients(
  db: DrizzleDb,
  orgId: string,
  limit = 200,
): Promise<RecipientRow[]> {
  const rows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.orgId, orgId))
    .orderBy(desc(suppliers.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * Delete, scoped.
 *
 * Returns whether a row went. The route needs to tell "not found" from "not
 * yours" apart internally while answering 404 to both, and a boolean is enough
 * for that without a second read.
 */
export async function deleteRecipient(
  db: DrizzleDb,
  orgId: string,
  recipientId: string,
): Promise<boolean> {
  const rows = await db
    .delete(suppliers)
    .where(and(eq(suppliers.id, recipientId), eq(suppliers.orgId, orgId)))
    .returning({ id: suppliers.id });
  return rows.length > 0;
}

/**
 * The beneficiary this invoice link refers to, within one org.
 *
 * Matched on the contact email where there is one and the name otherwise —
 * the same rule the in-memory version used, now with a tenant boundary. A
 * global name match would have resolved two tenants' "Acme Trading" to
 * whichever happened to sort first.
 */
export async function findRecipientByEmailOrName(
  db: DrizzleDb,
  orgId: string,
  input: { name: string; orgEmail?: string },
): Promise<RecipientRow | null> {
  const rows = await listRecipients(db, orgId, 500);
  const email = input.orgEmail?.trim().toLowerCase();
  const hit = rows.find((row) =>
    email
      ? row.orgEmail?.toLowerCase() === email
      : row.name.toLowerCase() === input.name.toLowerCase(),
  );
  return hit ?? null;
}

/**
 * Match a beneficiary by name across every org.
 *
 * Only the public pay link uses this, because `invoices` has no org id yet and
 * the issuer's name is the only key there is. It is a seam, and it is named
 * like one — see `findIssuerForPayLink` in the store.
 */
export async function findByNameAcrossOrgs(
  db: DrizzleDb,
  name: string,
): Promise<RecipientRow | null> {
  const rows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.name, name))
    .orderBy(desc(suppliers.createdAt))
    .limit(1);
  return rows.length > 0 ? toRow(rows[0]) : null;
}

export const __testing = { toColumnKyb, fromColumnKyb };
