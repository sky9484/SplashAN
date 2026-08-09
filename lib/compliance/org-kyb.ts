import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { organizations } from '../db/schema.ts';
import type * as schemaModule from '../db/schema.ts';
import {
  assertTransition,
  coarseKybStatus,
  toKybLifecycleState,
  type KybActor,
  type KybLifecycleState,
} from './kyb-state.ts';

/**
 * Persistence for the org KYB lifecycle (wallet spec §3).
 *
 * The pure rules live in kyb-state.ts; this module is the only thing that
 * touches the database, mirroring the loadOrgPolicy shape in
 * lib/policy/org-policy.ts (`db: null` = the DB-less demo path).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

/**
 * Is the KYB money gate enforced?
 *
 * Default OFF. Turning this on without every org having a real lifecycle row
 * would put the demo workspace — which `resolveAuthorityForSession`
 * auto-provisions with kyb_lifecycle defaulting to REGISTERED — into read-only
 * and break the `splash@demo` login. Enable it only once orgs are seeded.
 */
export function kybGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FEATURE_KYB_GATE === 'true';
}

/**
 * The state to assume when we cannot read one (no DATABASE_URL, missing row).
 * ACTIVE on purpose: the gate is opt-in, so an unreadable state must not
 * silently freeze a working demo. Once FEATURE_KYB_GATE is on in production
 * this is unreachable, because DATABASE_URL is required there.
 */
const ASSUMED_STATE_WITHOUT_DB: KybLifecycleState = 'ACTIVE';

async function resolveDb(): Promise<DrizzleDb | null> {
  if (!process.env.DATABASE_URL) return null;
  const { getDb } = await import('../db/client.ts');
  return getDb() as unknown as DrizzleDb;
}

export async function readOrgKybState(orgId: string): Promise<KybLifecycleState> {
  const db = await resolveDb();
  if (!db) return ASSUMED_STATE_WITHOUT_DB;

  const rows = await db
    .select({ lifecycle: organizations.kybLifecycle })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (rows.length === 0) return ASSUMED_STATE_WITHOUT_DB;
  return toKybLifecycleState(rows[0].lifecycle);
}

/**
 * Advance an org through the lifecycle. Throws KybTransitionError when the
 * move is illegal or the actor is not permitted to make it — that check is the
 * whole separation-of-duties control, so callers must not bypass it.
 *
 * Writes the coarse legacy `kyb_status` in the same statement so the two
 * columns can never drift.
 */
export async function setOrgKybState(
  orgId: string,
  to: KybLifecycleState,
  actor: KybActor,
): Promise<{ from: KybLifecycleState; to: KybLifecycleState }> {
  const from = await readOrgKybState(orgId);
  assertTransition(from, to, actor);

  const db = await resolveDb();
  if (db) {
    await db
      .update(organizations)
      .set({ kybLifecycle: to, kybStatus: coarseKybStatus(to), updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
  }

  console.info('[org-kyb] transition', { orgId, from, to, actor });
  return { from, to };
}

/** Record the org's on-chain BusinessAccount object id (wallet spec §2.3). */
export async function setOrgBusinessAccountId(orgId: string, objectId: string): Promise<void> {
  const db = await resolveDb();
  if (!db) return;
  await db
    .update(organizations)
    .set({ suiBusinessAccountId: objectId, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}
