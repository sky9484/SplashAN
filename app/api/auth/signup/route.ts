import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AccountExistsError, createAccount } from '@/lib/auth/accounts';
import { MIN_PASSWORD_LENGTH, PasswordError } from '@/lib/auth/password';
import { readJsonBody } from '@/lib/server/http';

/**
 * Create an account. It grants nothing.
 *
 * This route used to call `createSignupSession`, which took any email, ignored
 * the password entirely, and returned a signed session cookie. That session
 * then reached `resolveAuthorityForSession`, which provisioned a `checker`
 * membership — APPROVER — for anyone it did not recognise. Reaching this
 * endpoint was therefore sufficient to approve payments.
 *
 * What it does now: stores a scrypt hash, creates a user with no membership,
 * and returns 201 with no session. The new account can log in and see an empty
 * workspace; every financial route refuses it until someone with authority
 * grants a membership.
 *
 * No session is set here on purpose. Signing someone in as a side effect of
 * registration means an unverified address holds a session, and it was the
 * shape of the original defect.
 */

const signupSchema = z.object({
  company: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  region: z.string().trim().min(2).max(80),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
  accepted: z.literal(true),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.CUSTOMER_SELF_SIGNUP_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Business workspaces are provisioned by Splash in production' },
      { status: 403 },
    );
  }

  const parsed = signupSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `A valid company, business email, acceptance, and a password of at least ${MIN_PASSWORD_LENGTH} characters are required`,
      },
      { status: 400 },
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Account storage is not configured on this deployment' },
      { status: 503 },
    );
  }

  const { getDb } = await import('@/lib/db/client');
  const db = getDb() as never;

  try {
    await createAccount(db, {
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.company,
    });
  } catch (error) {
    if (error instanceof PasswordError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AccountExistsError) {
      // 201 either way. Telling a caller which addresses are registered turns
      // this endpoint into an account-enumeration oracle, and there is nothing
      // to protect: no session is issued and no authority is granted.
      return NextResponse.json({ created: true, authority: 'none' }, { status: 201 });
    }
    throw error;
  }

  return NextResponse.json(
    {
      created: true,
      /** Explicit, so a client cannot mistake registration for access. */
      authority: 'none',
      next: 'An administrator must grant access to a workspace before this account can act.',
    },
    { status: 201 },
  );
}
