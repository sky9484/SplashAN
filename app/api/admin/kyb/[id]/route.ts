import { NextResponse } from 'next/server';

import { getAdminSession } from '@/lib/server/admin-auth';
import { readJsonBody } from '@/lib/server/http';
import { readKybCase, reviewKybCase, type KybReviewState } from '@/lib/server/kyb';

const allowedStates = new Set<KybReviewState>(['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED']);

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  const { id } = await params;
  const record = readKybCase(id);

  if (!record) {
    return NextResponse.json({ error: 'KYB case not found' }, { status: 404 });
  }

  return NextResponse.json({ case: record });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  const { id } = await params;
  const body = await readJsonBody(request);
  const state = String(body.state ?? '') as KybReviewState;

  if (!allowedStates.has(state)) {
    return NextResponse.json({ error: 'Unsupported KYB state' }, { status: 400 });
  }

  const record = reviewKybCase(id, {
    state,
    actor: session.email,
    note: typeof body.note === 'string' ? body.note : undefined,
    assignedTo: typeof body.assignedTo === 'string' ? body.assignedTo : undefined,
  });

  if (!record) {
    return NextResponse.json({ error: 'KYB case not found' }, { status: 404 });
  }

  return NextResponse.json({ case: record });
}
