import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readAuditReceipt, readSweepJob, readTransferIntent } from '@/lib/server/operations';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const intent = readTransferIntent(id);

  if (!intent) {
    return NextResponse.json({ error: 'Transfer intent not found' }, { status: 404 });
  }

  // W9.5 — the delivery timeline renders REAL per-stage timestamps from the
  // lifecycle audit trail, never timer-faked progress.
  const statusHistory = readAuditReceipt(id)?.statusHistory ?? [];

  return NextResponse.json({
    ...intent,
    sweepJob: intent.sweepJobId ? readSweepJob(intent.sweepJobId) : null,
    statusHistory,
  });
}
