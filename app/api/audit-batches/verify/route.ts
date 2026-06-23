import { NextResponse } from 'next/server';

import { verifyDailyAuditBatch } from '@/lib/server/audit-batches';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { batchId?: string; transferId?: string };
    if (!body.batchId || !body.transferId) {
      return NextResponse.json({ error: 'batchId and transferId are required' }, { status: 400 });
    }
    return NextResponse.json(await verifyDailyAuditBatch(body.batchId, body.transferId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'verification failed' },
      { status: 400 },
    );
  }
}
