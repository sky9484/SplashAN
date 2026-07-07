import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { deleteRecipient, findRecipient } from '@/lib/server/operations';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const exists = findRecipient(id);
  if (!exists) {
    return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
  }
  deleteRecipient(id);
  return NextResponse.json({ ok: true });
}
