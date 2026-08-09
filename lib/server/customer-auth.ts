import 'server-only';

import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { customerRequestOriginAllowed } from '@/lib/auth/customer-request';
import { isKilledEntityEmail } from '@/lib/auth/killed-entities';
import {
  CUSTOMER_SESSION_COOKIE,
  FALLBACK_CUSTOMER_EMAIL,
  FALLBACK_CUSTOMER_ORGANIZATION,
  FALLBACK_CUSTOMER_PASSWORD,
  createCustomerSessionFromIdentity,
  createCustomerSessionToken,
  readCustomerSessionToken,
  timingSafeStrEqual,
  type CustomerSession,
  type CustomerWorkspaceRole,
} from '@/lib/auth/customer-session';

export type { CustomerSession } from '@/lib/auth/customer-session';
export { CUSTOMER_SESSION_COOKIE, createCustomerSessionToken, readCustomerSessionToken } from '@/lib/auth/customer-session';

const isProduction = process.env.NODE_ENV === 'production';
const DEV_SECRET_FILE = join(process.cwd(), '.customer-session-secret.local');
const defaultSessionTtlSeconds = 60 * 60 * 12;
const rememberedSessionTtlSeconds = 60 * 60 * 24 * 30;

let cachedDevSecret: string | null = null;

function resolveSecret(): string | null {
  const configured = process.env.CUSTOMER_SESSION_SECRET?.trim();
  if (configured) return configured;

  if (isProduction) return null;

  if (!cachedDevSecret) cachedDevSecret = loadOrCreateDevSecret();
  return cachedDevSecret;
}

function loadOrCreateDevSecret(): string {
  try {
    if (existsSync(DEV_SECRET_FILE)) {
      const existing = readFileSync(DEV_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // Fall through and regenerate.
  }

  const secret = randomBytes(32).toString('hex');
  try {
    writeFileSync(DEV_SECRET_FILE, secret, { flag: 'wx', mode: 0o600 });
    console.warn(
      '[customer-auth] CUSTOMER_SESSION_SECRET is not set. Generated a local dev ' +
        'secret at .customer-session-secret.local (gitignored). Set CUSTOMER_SESSION_SECRET before deploying.',
    );
    return secret;
  } catch {
    try {
      const existing = readFileSync(DEV_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {
      // Last resort: keep this process working in local development.
    }
    return secret;
  }
}

function sessionFromIdentity(input: {
  email: string;
  organization?: string;
  now?: Date;
  ttlSeconds?: number;
  userRole?: CustomerWorkspaceRole;
  suiAddress?: string;
  orgId?: string;
}): CustomerSession {
  return createCustomerSessionFromIdentity({
    ...input,
    fallbackOrganization: process.env.CUSTOMER_ORGANIZATION || FALLBACK_CUSTOMER_ORGANIZATION,
  });
}

export function validateCustomerCredentials(email: string, password: string): CustomerSession | null {
  if (isProduction) {
    const envEmail = process.env.CUSTOMER_EMAIL?.trim();
    const envPassword = process.env.CUSTOMER_PASSWORD;
    const envSecret = process.env.CUSTOMER_SESSION_SECRET?.trim();
    if (!envEmail || !envPassword || !envSecret) {
      console.error(
        '[customer-auth] Refusing login: CUSTOMER_EMAIL, CUSTOMER_PASSWORD and ' +
          'CUSTOMER_SESSION_SECRET must all be set in production.',
      );
      return null;
    }
  }

  const expectedEmail = String(process.env.CUSTOMER_EMAIL || FALLBACK_CUSTOMER_EMAIL).trim().toLowerCase();
  const expectedPassword = String(process.env.CUSTOMER_PASSWORD || FALLBACK_CUSTOMER_PASSWORD);

  if (String(email ?? '').trim().toLowerCase() !== expectedEmail) return null;
  if (!timingSafeStrEqual(String(password ?? ''), expectedPassword)) return null;

  // Wallet spec §2.4 — a killed entity must not bind in through the auth layer.
  if (isKilledEntityEmail(expectedEmail)) {
    console.error('[customer-auth] Refusing login: killed-entity domain.');
    return null;
  }

  return sessionFromIdentity({ email: expectedEmail });
}

export function createSignupSession(input: { email: string; organization: string }): CustomerSession {
  return sessionFromIdentity({
    email: input.email,
    organization: input.organization,
  });
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const secret = resolveSecret();
  if (!secret) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  return readCustomerSessionToken(token, secret);
}

export async function requireCustomerSession(): Promise<
  { session: CustomerSession; response: null } | { session: null; response: NextResponse }
> {
  const session = await getCustomerSession();
  return session ? { session, response: null } : { session: null, response: customerAuthRequiredResponse() };
}

export async function requireCustomerRequest(request: Request): Promise<
  { session: CustomerSession; response: null } | { session: null; response: NextResponse }
> {
  const auth = await requireCustomerSession();
  if (auth.response) return auth;

  if (!customerRequestOriginAllowed(request)) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Request origin is not allowed', code: 'invalid_request_origin' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }

  return auth;
}

export async function setCustomerSessionCookie(
  session: CustomerSession,
  options: { remember?: boolean; secure?: boolean } = {},
) {
  const secret = resolveSecret();
  if (!secret) {
    throw new Error('Cannot create customer session: CUSTOMER_SESSION_SECRET is not configured.');
  }

  const maxAge = options.remember ? rememberedSessionTtlSeconds : defaultSessionTtlSeconds;
  // Rebuild only to refresh issuedAt/expiresAt — every other field must be
  // threaded through, or it is silently lost on re-issue (which is how a
  // session quietly reverts to a stale role/address).
  const refreshedSession = sessionFromIdentity({
    email: session.email,
    organization: session.organization,
    ttlSeconds: maxAge,
    userRole: session.userRole,
    suiAddress: session.suiAddress,
    orgId: session.orgId,
  });
  const cookieStore = await cookies();

  cookieStore.set(CUSTOMER_SESSION_COOKIE, createCustomerSessionToken(refreshedSession, secret), {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'lax',
    secure: options.secure ?? isProduction,
  });

  return refreshedSession;
}

export async function clearCustomerSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
}

export function customerAuthRequiredResponse() {
  return NextResponse.json(
    { error: 'Business authentication required', code: 'customer_auth_required' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}
