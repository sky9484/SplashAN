import { NextResponse } from 'next/server';

import { readSweepJob, readTransferIntent } from '@/lib/server/operations';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = readTransferIntent(id);

  if (!intent) {
    return NextResponse.json({ error: 'Transfer intent not found' }, { status: 404 });
  }

  return NextResponse.json({ ...intent, sweepJob: intent.sweepJobId ? readSweepJob(intent.sweepJobId) : null });
}
