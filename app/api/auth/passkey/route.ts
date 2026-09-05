import { NextResponse } from 'next/server';
import { z } from 'zod';

import { userIdFromEmail } from '@/lib/auth/accounts';
import {
  PasskeyError,
  enrolPasskey,
  findCredential,
  relyingPartyId,
  revokePasskey,
} from '@/lib/auth/passkey';
import { requireCustomerSession } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

/**
 * Passkey enrolment.
 *
 * GET  — what this account has on this origin, and the rpId to enrol against.
 * POST — record a newly created credential's public key.
 * DELETE — retire it.
 *
 * The POST body carries a public key the browser has just been given by the
 * authenticator. That is the one moment it exists outside the device: WebAuthn
 * returns it in the attestation at creation and never again. Storing it here
 * is what lets a later signature be attributed without asking the user to sign
 * twice so the key can be recovered by intersection.
 *
 * Enrolment requires an authenticated session, so a credential is always bound
 * to a known identity. It grants nothing on its own — a passkey is how an
 * approval is signed, not permission to approve. Authority is still a
 * membership row, read per request.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enrolSchema = z.object({
  /** WebAuthn credential id, base64url, as returned by the authenticator. */
  credentialId: z.string().trim().min(1).max(512),
  /** 33-byte compressed secp256r1 point, base64. Validated in lib/auth/passkey. */
  publicKey: z.string().trim().min(1).max(256),
});

async function db() {
  const { getDb } = await import('@/lib/db/client');
  return getDb() as never;
}

export async function GET() {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;

  const rpId = relyingPartyId();
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ rpId, credential: null, storage: false }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const credential = await findCredential(await db(), {
    userId: userIdFromEmail(auth.session.email),
    rpId,
  });

  return NextResponse.json(
    {
      rpId,
      storage: true,
      credential: credential
        ? {
            id: credential.id,
            suiAddress: credential.suiAddress,
            // The public key is not returned. Nothing client-side needs it —
            // verification happens here — and it is the value the design
            // depends on retaining.
          }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Passkey storage is not configured on this deployment' }, { status: 503 });
  }

  const parsed = enrolSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A credential id and public key are required' }, { status: 400 });
  }

  try {
    const credential = await enrolPasskey(await db(), {
      userId: userIdFromEmail(auth.session.email),
      credentialId: parsed.data.credentialId,
      publicKey: parsed.data.publicKey,
      rpId: relyingPartyId(),
    });
    return NextResponse.json(
      { enrolled: true, suiAddress: credential.suiAddress, rpId: credential.rpId },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PasskeyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE() {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Passkey storage is not configured on this deployment' }, { status: 503 });
  }

  const database = await db();
  const rpId = relyingPartyId();
  const credential = await findCredential(database, { userId: userIdFromEmail(auth.session.email), rpId });
  if (!credential) return NextResponse.json({ revoked: false }, { status: 404 });

  await revokePasskey(database, credential.id);
  return NextResponse.json({ revoked: true });
}
