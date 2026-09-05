import { loadOpenProposals, upsertProposal } from '../db/proposal-repo.ts';
import type { InMemoryProposalStore } from './proposal-state.ts';
import type { UnsignedProposal } from '../agent/types';

/**
 * W1 PR-B — glue between the hot in-memory proposal store and Postgres.
 *
 * - With DATABASE_URL set (DigitalOcean cluster), every store mutation
 *   write-throughs to the proposals/approvals tables, and the store hydrates
 *   open proposals on first touch after boot — a pending approval survives a
 *   cold start.
 * - Without DATABASE_URL (local demo today), everything stays in-memory and
 *   behavior is unchanged. The pglite test suite exercises the DB path.
 */

export function proposalPersistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function db() {
  const { getDb } = await import('../db/client.ts');
  return getDb();
}

export function makeProposalWriter(): ((proposal: UnsignedProposal) => Promise<void>) | undefined {
  if (!proposalPersistenceEnabled()) return undefined;
  return async (proposal) => {
    await upsertProposal(await db(), proposal);
  };
}

const hydrated = { done: false, inFlight: null as Promise<void> | null };

/** Idempotent boot hydration — await from any async server context (queue
 *  page, proposal API routes) before reading the store after a restart. */
export async function ensureProposalStoreHydrated(store: InMemoryProposalStore): Promise<void> {
  if (!proposalPersistenceEnabled() || hydrated.done) return;
  hydrated.inFlight ??= (async () => {
    try {
      store.hydrate(await loadOpenProposals(await db()));
      hydrated.done = true;
    } catch (error) {
      console.error('[proposal-store] hydration failed (continuing in-memory)', error);
    } finally {
      hydrated.inFlight = null;
    }
  })();
  await hydrated.inFlight;
}
