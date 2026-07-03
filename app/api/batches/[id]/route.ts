import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readBatch } from '@/lib/server/operations';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const batch = readBatch(id);

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  return NextResponse.json(batch);
}
