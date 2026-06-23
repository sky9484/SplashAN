import { NextResponse } from 'next/server';

import { operations, readSweepJob } from '@/lib/server/operations';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') ?? 'all';
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10));
  const perPage = searchParams.get('export') === 'true' ? Number.MAX_SAFE_INTEGER : 20;

  let records = [...operations.transfers.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (filter === 'successful') {
    records = records.filter((r) => r.state === 'SETTLED' || r.state === 'DISBURSED' || r.state === 'CREDITED');
  } else if (filter === 'failed') {
    records = records.filter((r) => r.state === 'FAILED' || r.state === 'REFUNDED' || r.state === 'REFUNDING');
  } else if (filter === 'pending') {
    records = records.filter(
      (r) => r.state !== 'SETTLED' && r.state !== 'DISBURSED' && r.state !== 'CREDITED' && r.state !== 'FAILED' && r.state !== 'REFUNDED',
    );
  }

  const total = records.length;
  const items = records.slice((page - 1) * perPage, page * perPage).map((record) => ({
    ...record,
    heldDurationMs: record.sweepJobId ? readSweepJob(record.sweepJobId)?.heldDurationMs ?? null : null,
  }));

  return NextResponse.json({ items, total, page, perPage });
}
