import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { readInvoice, updateInvoice } from '@/lib/server/operations';

const patchSchema = z.object({
  status: z.enum(['draft', 'sent', 'viewed', 'paid', 'settled', 'overdue']).optional(),
  paymentReference: z.string().trim().optional(),
  transferIntentId: z.string().trim().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const invoice = readInvoice(id);
  return invoice
    ? NextResponse.json(invoice)
    : NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid invoice update' }, { status: 400 });
  const invoice = updateInvoice(id, parsed.data);
  return invoice
    ? NextResponse.json(invoice)
    : NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
}
