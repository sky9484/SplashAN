import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { loginAttempts } from '../db/schema.ts';
import type * as schemaModule from '../db/schema.ts';

/**
 * Login rate limiting: 5 failures per email per 15 minutes, 20 per IP per
 * hour.
 *
 * Two windows because they stop different things. The per-email limit stops
 * an attacker guessing one account's password. The per-IP limit stops one
 * source spraying a common password across many accounts, which the per-email
 * limit alone never sees — each individual account stays under its own
 * threshold.
 *
 * In Postgres, not Redis. Redis is cache-only by the rule in db/schema.ts, and
 * a lockout that disappears when the cache restarts is not a lockout — it is a
 * short pause an attacker can trigger deliberately.
 *
 * Only FAILURES are recorded. Counting successes would lock out the one person
 * who is legitimately signing in repeatedly, and a successful login clears the
 * email's failures, so a user who mistypes twice and then succeeds starts
 * clean.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

export const EMAIL_LIMIT = 5;
export const EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const IP_LIMIT = 20;
export const IP_WINDOW_MS = 60 * 60 * 1000;

/** The longest window, which is how long a row can still matter. */
const MAX_WINDOW_MS = Math.max(EMAIL_WINDOW_MS, IP_WINDOW_MS);

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; scope: 'email' | 'ip'; retryAfterSeconds: number };

const norm = (email: string) => email.trim().toLowerCase();

/**
 * Whether this attempt may proceed. Call BEFORE verifying the password —
 * checking afterwards would let an attacker keep testing candidates while the
 * limiter only ever counted attempts it had already answered.
 */
export async function checkLoginRateLimit(
  db: DrizzleDb,
  input: { email: string; ip: string; now?: Date },
): Promise<RateLimitVerdict> {
  const now = input.now ?? new Date();
  const email = norm(input.email);

  // Prune as we read: the table stays small without a scheduled job, and a row
  // older than the longest window can never affect a verdict.
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - MAX_WINDOW_MS)));

  const emailSince = new Date(now.getTime() - EMAIL_WINDOW_MS);
  const emailRows = await db
    .select({ attemptedAt: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gte(loginAttempts.attemptedAt, emailSince)))
    .orderBy(loginAttempts.attemptedAt);

  if (emailRows.length >= EMAIL_LIMIT) {
    // The window frees up when the OLDEST counted failure ages out.
    const oldest = emailRows[0].attemptedAt.getTime();
    const retryAt = oldest + EMAIL_WINDOW_MS;
    return { allowed: false, scope: 'email', retryAfterSeconds: retryAfter(retryAt, now) };
  }

  const ipSince = new Date(now.getTime() - IP_WINDOW_MS);
  const ipRows = await db
    .select({ attemptedAt: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, input.ip), gte(loginAttempts.attemptedAt, ipSince)))
    .orderBy(loginAttempts.attemptedAt);

  if (ipRows.length >= IP_LIMIT) {
    const oldest = ipRows[0].attemptedAt.getTime();
    const retryAt = oldest + IP_WINDOW_MS;
    return { allowed: false, scope: 'ip', retryAfterSeconds: retryAfter(retryAt, now) };
  }

  return { allowed: true };
}

function retryAfter(retryAt: number, now: Date): number {
  return Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000));
}

/** Record a failed attempt. Called only on failure. */
export async function recordFailedLogin(
  db: DrizzleDb,
  input: { email: string; ip: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.insert(loginAttempts).values({
    id: `att_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`,
    email: norm(input.email),
    ip: input.ip,
    attemptedAt: now,
  });
}

/** Clear an email's failures after a successful login. */
export async function clearLoginFailures(db: DrizzleDb, email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, norm(email)));
}

/**
 * The client address, from the proxy headers the app already trusts for
 * origin checks. Falls back to a constant rather than to something
 * attacker-controlled: an unknown source shares one bucket, which is
 * restrictive, and being wrong in the restrictive direction is the right way
 * to be wrong here.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Count rows in the window, for tests and the health surface. */
export async function countRecentFailures(
  db: DrizzleDb,
  input: { email?: string; ip?: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  if (input.email) {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, norm(input.email)),
          gte(loginAttempts.attemptedAt, new Date(now.getTime() - EMAIL_WINDOW_MS)),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, input.ip ?? ''),
        gte(loginAttempts.attemptedAt, new Date(now.getTime() - IP_WINDOW_MS)),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}
