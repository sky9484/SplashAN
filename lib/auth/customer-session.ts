import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type CustomerSession = {
  email: string;
  name: string;
  organization: string;
  role: 'business_admin';
  issuedAt: string;
  expiresAt: string;
};

type CustomerTokenPayload = CustomerSession & {
  nonce: string;
  iat: number;
  exp: number;
};

export const CUSTOMER_SESSION_COOKIE = 'splash_customer_session';
export const FALLBACK_CUSTOMER_EMAIL = 'demo@splash.finance';
export const FALLBACK_CUSTOMER_PASSWORD = 'Demo@12345';
export const FALLBACK_CUSTOMER_ORGANIZATION = 'Splash Demo Ltd';

export function timingSafeStrEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createCustomerSessionFromIdentity(input: {
  email: string;
  organization?: string;
  now?: Date;
  ttlSeconds?: number;
  fallbackOrganization?: string;
}): CustomerSession {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? 60 * 60 * 12) * 1000);
  const normalizedEmail = input.email.trim().toLowerCase();
  const localPart = normalizedEmail.split('@')[0] || 'operator';

  return {
    email: normalizedEmail,
    name: localPart.replace(/[._-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    organization: input.organization?.trim() || input.fallbackOrganization || FALLBACK_CUSTOMER_ORGANIZATION,
    role: 'business_admin',
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function createCustomerSessionToken(
  session: CustomerSession,
  secret: string,
  nowMs = Date.now(),
): string {
  const payload: CustomerTokenPayload = {
    ...session,
    nonce: randomBytes(12).toString('hex'),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(new Date(session.expiresAt).getTime() / 1000),
  };
  const encoded = encodeBase64Url(JSON.stringify(payload));
  return `${encoded}.${signPayload(encoded, secret)}`;
}

export function readCustomerSessionToken(
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): CustomerSession | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = signPayload(encoded, secret);
  if (!timingSafeStrEqual(mac, expected)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as Partial<CustomerTokenPayload>;
    if (!payload.email || !payload.name || !payload.organization || payload.role !== 'business_admin') return null;
    if (!payload.exp || payload.exp * 1000 <= nowMs) return null;

    return {
      email: payload.email,
      name: payload.name,
      organization: payload.organization,
      role: payload.role,
      issuedAt: payload.issuedAt || new Date((payload.iat ?? 0) * 1000).toISOString(),
      expiresAt: payload.expiresAt || new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}
