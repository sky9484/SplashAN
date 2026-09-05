import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCustomerSessionFromIdentity,
  createCustomerSessionToken,
  readCustomerSessionToken,
  timingSafeStrEqual,
} from '../lib/auth/customer-session.ts';
import { customerRequestOriginAllowed } from '../lib/auth/customer-request.ts';

const secret = 'test-secret-with-enough-entropy-for-hmac-signing';
const now = Date.parse('2026-07-03T12:00:00.000Z');

test('customer session tokens round-trip normalized identity fields', () => {
  const session = createCustomerSessionFromIdentity({
    email: ' Ops.Team+Demo@Example.COM ',
    organization: ' Acme Treasury ',
    now: new Date(now),
    ttlSeconds: 60,
  });
  const token = createCustomerSessionToken(session, secret, now);
  const decoded = readCustomerSessionToken(token, secret, now + 1_000);

  assert.equal(decoded?.email, 'ops.team+demo@example.com');
  assert.equal(decoded?.name, 'Ops Team+Demo');
  assert.equal(decoded?.organization, 'Acme Treasury');
  assert.equal(decoded?.role, 'business_admin');
});

test('customer session tokens reject tampered signatures', () => {
  const session = createCustomerSessionFromIdentity({
    email: 'finance@example.com',
    now: new Date(now),
    ttlSeconds: 60,
  });
  const token = createCustomerSessionToken(session, secret, now);
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

  assert.equal(readCustomerSessionToken(tampered, secret, now), null);
});

test('customer session tokens reject expired payloads', () => {
  const session = createCustomerSessionFromIdentity({
    email: 'finance@example.com',
    now: new Date(now),
    ttlSeconds: 1,
  });
  const token = createCustomerSessionToken(session, secret, now);

  assert.equal(readCustomerSessionToken(token, secret, now + 2_000), null);
});

test('timing-safe string comparison handles equal and unequal lengths', () => {
  assert.equal(timingSafeStrEqual('same-value', 'same-value'), true);
  assert.equal(timingSafeStrEqual('same-value', 'same-value-extra'), false);
});

test('customer request origin guard allows safe reads and same-origin writes', () => {
  assert.equal(customerRequestOriginAllowed(new Request('https://app.example.test/api/recipients')), true);
  assert.equal(
    customerRequestOriginAllowed(new Request('https://app.example.test/api/recipients', {
      method: 'POST',
      headers: { origin: 'https://app.example.test' },
    })),
    true,
  );
});

test('customer request origin guard rejects cross-site writes', () => {
  assert.equal(
    customerRequestOriginAllowed(new Request('https://app.example.test/api/recipients', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })),
    false,
  );
  assert.equal(
    customerRequestOriginAllowed(new Request('https://app.example.test/api/recipients', {
      method: 'DELETE',
      headers: { 'sec-fetch-site': 'cross-site' },
    })),
    false,
  );
});

test('customer request origin guard falls back to referer when origin is absent', () => {
  assert.equal(
    customerRequestOriginAllowed(new Request('https://app.example.test/api/settings', {
      method: 'PUT',
      headers: { referer: 'https://app.example.test/dashboard/settings' },
    })),
    true,
  );
  assert.equal(
    customerRequestOriginAllowed(new Request('https://app.example.test/api/settings', {
      method: 'PUT',
      headers: { referer: 'https://evil.example/page' },
    })),
    false,
  );
});
