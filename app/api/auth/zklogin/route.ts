import { NextResponse } from 'next/server';
import { ensureWorkspaceForEmail } from '@/lib/auth/signup-org';
import { z } from 'zod';

import { isKilledEntityEmail } from '@/lib/auth/killed-entities';
import {
  ZkLoginVerificationError,
  expectedNonce,
  hashSubjectForLog,
  verifyZkLoginJwt,
  zkLoginEnabled,
  deriveZkLoginAddress,
} from '@/lib/auth/zklogin';
import { ensureUserForIdentity, upsertWalletIdentity } from '@/lib/db/wallet-identities';
import { createCustomerSessionFromIdentity } from '@/lib/auth/customer-session';
import { setCustomerSessionCookie } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * zkLogin sign-in (wallet spec §4).
 *
 * The client does OAuth + ephemeral key + ZK proof; this route independently
 * verifies the JWT server-side and, only then, mints the SAME HMAC session
 * cookie the password path uses. Authority is still resolved per-request by
 * lib/auth/authority.ts — this route changes how identity is *proved*, not how
 * authority is *derived* (Invariant #8).
 *
 * Ships disabled: FEATURE_ZKLOGIN must be 'true' AND the environment's OAuth
 * client id must be configured. The password path (splash@demo) is untouched.
 */
const zkLoginSchema = z.object({
  jwt: z.string().trim().min(1).max(8192),
  provider: z.enum(['google', 'microsoft']),
  /** Ephemeral key material, so the server can recompute the expected nonce. */
  ephemeralPublicKey: z.string().trim().min(1).max(512).optional(),
  maxEpoch: z.number().int().nonnegative().optional(),
  randomness: z.string().trim().min(1).max(256).optional(),
  remember: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!zkLoginEnabled()) {
    return NextResponse.json(
      { error: 'zkLogin sign-in is not enabled in this environment.', code: 'zklogin_disabled' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = zkLoginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A provider and JWT are required.' }, { status: 400 });
  }
  const { jwt, provider, ephemeralPublicKey, maxEpoch, randomness, remember } = parsed.data;

  try {
    // Recompute the nonce from the ephemeral key the client presented, so the
    // token is bound to the key that will actually sign (IACR mitigation ii).
    const nonce = ephemeralPublicKey && typeof maxEpoch === 'number' && randomness
      ? await expectedNonce({ ephemeralPublicKeyB64: ephemeralPublicKey, maxEpoch, randomness })
      : undefined;

    const claims = await verifyZkLoginJwt({ jwt, provider, expectedNonce: nonce });

    const email = (claims.email ?? '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: 'Your provider did not release an email address; ask your admin to grant the email scope.' },
        { status: 403 },
      );
    }
    // Wallet spec §2.4 — killed entities must not bind in through auth.
    if (isKilledEntityEmail(email)) {
      return NextResponse.json({ error: 'Onboarding is not available for this domain.' }, { status: 403 });
    }

    // Identity is proven — persist it (wallet spec §2.3) so maker-checker can
    // attribute a signature to a named human. Requires a salt to derive the
    // address; without one we still mint a session, we just have no signer to
    // record yet.
    let suiAddress: string | undefined;
    const userSalt = (process.env.ZKLOGIN_USER_SALT ?? '').trim();
    if (userSalt && process.env.DATABASE_URL) {
      try {
        suiAddress = await deriveZkLoginAddress(jwt, userSalt);
        const { getDb } = await import('@/lib/db/client');
        const db = getDb() as never;
        const userId = `op_${email}`;
        // Their OWN workspace, in REGISTERED.
        //
        // This used to be DEFAULT_ORG_ID — the literal 'demo-business' — so
        // every person who signed in with Google was filed under one shared
        // organisation. The damage was bounded by an accident rather than a
        // decision: zkLogin grants no membership and authority is read from the
        // membership row, so a new signer could authorise nothing. But their
        // identity and their Sui address sat in the demo org's namespace, and
        // the moment anyone granted them a role they would have landed inside
        // it.
        const workspace = await ensureWorkspaceForEmail(email);
        await ensureUserForIdentity(db, { userId, orgId: workspace.orgId, email });
        await upsertWalletIdentity(db, {
          userId,
          orgId: workspace.orgId,
          suiAddress,
          oauthIss: claims.iss,
          oauthSub: claims.sub,
          oauthAud: claims.aud,
          emailAtLogin: email,
        });
      } catch (error) {
        // A rebind conflict is a real signal, not noise — surface it rather
        // than minting a session against an identity we could not record.
        console.error('[zklogin] wallet identity persistence failed', error);
        return NextResponse.json(
          { error: 'Your wallet identity could not be verified. Contact support.', code: 'identity_conflict' },
          { status: 409 },
        );
      }
    }

    // The session's org is the signer's own workspace, resolved the same way
    // the identity row was. The cookie is display-only by contract — authority
    // is re-read from the membership table per request — but a cookie naming
    // the demo org would still show the wrong workspace name on every screen.
    const sessionWorkspace = await ensureWorkspaceForEmail(email);
    const session = createCustomerSessionFromIdentity({
      email,
      suiAddress,
      orgId: sessionWorkspace.orgId,
      fallbackOrganization: process.env.CUSTOMER_ORGANIZATION,
    });
    const refreshed = await setCustomerSessionCookie(session, { remember });

    console.info('[zklogin] session minted', {
      provider,
      subject: hashSubjectForLog(claims.iss, claims.sub, claims.aud),
      nonceBound: Boolean(nonce),
    });

    return NextResponse.json({ session: refreshed });
  } catch (error) {
    if (error instanceof ZkLoginVerificationError) {
      // Log the precise reason; tell the client only that it failed.
      console.warn('[zklogin] verification rejected', { provider, code: error.code, message: error.message });
      return NextResponse.json(
        { error: 'Sign-in could not be verified.', code: error.code },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('[zklogin] unexpected failure', error);
    return NextResponse.json({ error: 'Sign-in failed.' }, { status: 500 });
  }
}
