import { NextResponse } from 'next/server';

import { listDailyAuditBatches } from '@/lib/server/audit-batches';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ items: listDailyAuditBatches() });
}
