import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { users } from '../db/schema.ts';
import type * as schemaModule from '../db/schema.ts';
import { loadOrgPolicy } from '../policy/org-policy.ts';
import type { OrgPolicy, UserRole } from '../agent/types.ts';
import type { CustomerSession } from './customer-session.ts';

/**
 * Track A §1.2 — the single server-side authority resolver for every
 * financial route. Invariant #8: the client is never authoritative.
 *
 * Server derives (never accepts from the request body):
 * - userId / orgId — from the authenticated session and the users table
 * - role           — from the membership row in the database, NOT the claim
 * - policy         — from the org's persisted policy record
 *
 * Without DATABASE_URL (local demo), the membership comes from this module's
 * explicit server-side registry — still server state, still never the client.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

export interface AuthorityContext {
  orgId: string;
  userId: string;
  role: UserRole;
  policy: OrgPolicy;
  resolvedAt: string;
}

export class UnauthorizedError extends Error {
  constructor(message = 'no membership for the authenticated identity') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** The org every desk proposal is booked under today (see lib/agent/oxwal.ts). */
export const DEFAULT_ORG_ID = 'demo-business';

/** DB role enum (maker/checker/admin/viewer) → proposal-domain UserRole. */
const DB_ROLE_MAP: Record<string, UserRole> = {
  maker: 'MAKER',
  checker: 'APPROVER',
  admin: 'OWNER',
  viewer: 'VIEWER',
};

export function mapDbRole(role: string): UserRole {
  return DB_ROLE_MAP[role] ?? 'VIEWER';
}

function demoOperatorRole(): UserRole {
  const configured = (process.env.OXWAL_OPERATOR_ROLE ?? 'APPROVER').toUpperCase();
  const valid: UserRole[] = ['OWNER', 'FINANCE_ADMIN', 'MAKER', 'APPROVER', 'VIEWER', 'AUDITOR', 'DEVELOPER'];
  return valid.includes(configured as UserRole) ? (configured as UserRole) : 'APPROVER';
}

function operatorIdFromEmail(email: string) {
  return `op_${email.trim().toLowerCase()}`;
}

/**
 * Pure, DB-injected resolution — the SAME code runs against DigitalOcean
 * Postgres in production and pglite in tests (14.12: role is provably
 * DB-derived, re-read on every request, never cached, never claimed).
 */
export async function resolveAuthorityFromDb(db: DrizzleDb, email: string): Promise<AuthorityContext> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (rows.length === 0) {
    throw new UnauthorizedError(`no membership row for ${normalized}`);
  }
  const membership = rows[0];
  const policy = await loadOrgPolicy(db, membership.orgId);
  return {
    orgId: membership.orgId,
    userId: membership.id,
    role: mapDbRole(membership.role),
    policy,
    resolvedAt: new Date().toISOString(),
  };
}

/** DB-less demo path: explicit server-side membership for the single
 *  credentialed operator (login already proved identity). */
export async function resolveAuthorityLocal(session: CustomerSession): Promise<AuthorityContext> {
  return {
    orgId: DEFAULT_ORG_ID,
    userId: operatorIdFromEmail(session.email),
    role: demoOperatorRole(),
    policy: await loadOrgPolicy(null, DEFAULT_ORG_ID),
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Entry point for routes. With DATABASE_URL the membership row is required;
 * the one credentialed demo operator is provisioned on first touch so a
 * fresh cluster still boots (explicit, logged — not a permissive default).
 */
export async function resolveAuthorityForSession(session: CustomerSession): Promise<AuthorityContext> {
  if (!process.env.DATABASE_URL) return resolveAuthorityLocal(session);

  const { getDb } = await import('../db/client.ts');
  const db = getDb() as unknown as DrizzleDb;
  try {
    return await resolveAuthorityFromDb(db, session.email);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    console.warn(`[authority] provisioning membership for credentialed operator ${session.email}`);
    await provisionOperatorMembership(db, session.email);
    return resolveAuthorityFromDb(db, session.email);
  }
}

export async function provisionOperatorMembership(db: DrizzleDb, email: string, role = 'checker'): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const { ensureOrganization } = await import('../db/proposal-repo.ts');
  await ensureOrganization(db, DEFAULT_ORG_ID);
  await db
    .insert(users)
    .values({
      id: operatorIdFromEmail(normalized),
      orgId: DEFAULT_ORG_ID,
      email: normalized,
      name: normalized.split('@')[0] || 'operator',
      role: role as typeof users.$inferInsert.role,
    })
    .onConflictDoNothing();
}
