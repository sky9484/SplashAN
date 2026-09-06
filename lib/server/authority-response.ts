import { NextResponse } from 'next/server';

import { UnauthorizedError } from '@/lib/auth/authority';

/**
 * Turn a missing membership into an answer the reader can act on.
 *
 * `resolveAuthorityForSession` throws `UnauthorizedError` for a signed-in
 * person who has no membership — which is Phase 3 working, not a failure. But
 * nothing caught it, so every route that resolves an account answered 500, and
 * the screens rendered that as the feature being broken: the transfer desk told
 * an approver "Payment sources unavailable / Funding sources are unavailable"
 * when the real and entirely different problem was that their account had not
 * been granted access to the workspace.
 *
 * A 403 that names the cause costs nothing and is the difference between "this
 * product is broken" and "ask an admin to grant you access".
 */
export function authorityErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof UnauthorizedError)) return null;

  return NextResponse.json(
    {
      error: 'Your account is not a member of a Splash workspace yet, so there is nothing to show here. An administrator can grant access from the staff console.',
      code: 'no_membership',
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}
