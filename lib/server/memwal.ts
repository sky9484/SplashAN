/**
 * MemWal (Walrus Memory) — privacy-first AI memory for the Splash Copilot.
 *
 * A delegate Ed25519 key signs requests to the MemWal relayer (a TEE that does
 * embedding, SEAL encryption, and Walrus storage server-side). The private key
 * NEVER leaves the server — this module must only be imported from server code
 * (API routes / server actions).
 *
 * Every helper is defensive: if MemWal is unconfigured or the relayer errors
 * (e.g. 401 before the delegate key is registered), it degrades to a no-op so
 * the Copilot keeps working without memory rather than crashing.
 *
 * Env (see .env.example):
 *   MEMWAL_PRIVATE_KEY  – delegate Ed25519 private key (hex)         [secret]
 *   MEMWAL_ACCOUNT_ID   – Walrus Memory account object ID on Sui
 *   MEMWAL_SERVER_URL   – relayer URL (default relayer.memory.walrus.xyz)
 *   MEMWAL_NAMESPACE    – memory namespace (default "splash-copilot")
 */

import { MemWal } from '@mysten-incubation/memwal';

const DEFAULT_SERVER_URL = 'https://relayer.memory.walrus.xyz';
const DEFAULT_NAMESPACE = 'splash-copilot';

export type RecalledMemory = { text: string; distance: number };

let client: MemWal | null = null;
let warned = false;

export function memwalConfigured(): boolean {
  return Boolean(process.env.MEMWAL_PRIVATE_KEY && process.env.MEMWAL_ACCOUNT_ID);
}

/** Lazily build a singleton MemWal client, or null when unconfigured. */
function getClient(): MemWal | null {
  if (!memwalConfigured()) {
    if (!warned) {
      console.warn('[memwal] disabled — set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID in .env.local');
      warned = true;
    }
    return null;
  }
  if (!client) {
    client = MemWal.create({
      key: process.env.MEMWAL_PRIVATE_KEY!,
      accountId: process.env.MEMWAL_ACCOUNT_ID!,
      serverUrl: process.env.MEMWAL_SERVER_URL ?? DEFAULT_SERVER_URL,
      namespace: process.env.MEMWAL_NAMESPACE ?? DEFAULT_NAMESPACE,
    });
  }
  return client;
}

/** Semantic recall. Returns [] on any error (never throws). */
export async function recallMemories(query: string, limit = 5): Promise<RecalledMemory[]> {
  const m = getClient();
  if (!m || !query.trim()) return [];
  try {
    const res = await m.recall({ query, limit });
    return res.results
      .filter((r) => r.text?.trim())
      .map((r) => ({ text: r.text, distance: r.distance }));
  } catch (error) {
    console.warn('[memwal] recall failed:', (error as Error)?.message ?? String(error));
    return [];
  }
}

/** Persist a memory (fire-and-forget; server accepts a background job). */
export async function rememberFact(text: string): Promise<boolean> {
  const m = getClient();
  if (!m || !text.trim()) return false;
  try {
    await m.remember(text.trim());
    return true;
  } catch (error) {
    console.warn('[memwal] remember failed:', (error as Error)?.message ?? String(error));
    return false;
  }
}

/** Extract salient facts from a conversation turn and store each. */
export async function analyzeAndRemember(text: string): Promise<boolean> {
  const m = getClient();
  if (!m || !text.trim()) return false;
  try {
    await m.analyze(text.trim());
    return true;
  } catch (error) {
    console.warn('[memwal] analyze failed:', (error as Error)?.message ?? String(error));
    return false;
  }
}

/** Liveness probe for the relayer (public, unsigned). null on failure. */
export async function memwalHealth(): Promise<unknown | null> {
  const m = getClient();
  if (!m) return null;
  try {
    return await m.health();
  } catch {
    return null;
  }
}
