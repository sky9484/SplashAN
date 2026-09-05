import { NextResponse } from 'next/server';

import { requireCustomerRequest, requireCustomerSession } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import {
  cancelPendingRequest,
  getCustomerProfile,
  getPendingRequest,
  listRequestsForCustomer,
  submitProfileChangeRequest,
} from '@/lib/server/customer-profile';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;
  const { session } = auth;

  return NextResponse.json({
    profile: getCustomerProfile(session),
    pendingRequest: getPendingRequest(session.email),
    history: listRequestsForCustomer(session.email).slice(0, 10),
  });
}

/** Submit an edit for admin review (maker side of maker-checker). */
export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;
  const { session } = auth;

  try {
    const body = await readJsonBody(request);
    const changeRequest = submitProfileChangeRequest(session, body as Record<string, unknown>);
    return NextResponse.json({ pendingRequest: changeRequest }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to submit the change request.' },
      { status: 400 },
    );
  }
}

/** Withdraw the pending request. */
export async function DELETE(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;
  const { session } = auth;

  try {
    return NextResponse.json({ request: cancelPendingRequest(session.email) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to cancel the change request.' },
      { status: 400 },
    );
  }
}
