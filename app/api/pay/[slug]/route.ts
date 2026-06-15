import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  findInvoiceBySlug,
  listRecipients,
  recordAnalyticsEvent,
  updateInvoice,
  upsertRecipientFromInvoice,
} from '@/lib/server/operations';

export const BANK_TRANSFER_INSTRUCTIONS = {
  beneficiary: 'Splash Labuan Ltd client account',
  bank: 'Maybank International Labuan Branch',
  account: 'CLIENT-USD-SETTLEMENT',
  swift: 'MBBEMYKL',
};

const paidSchema = z.object({
  payerOrgName: z.string().trim().min(2),
  payerOrgEmail: z.string().email(),
  paymentReference: z.string().trim().min(4),
});

function publicInvoice(slug: string) {
  const invoice = findInvoiceBySlug(slug);
  if (!invoice) return null;
  const issuer = listRecipients().find((recipient) => recipient.name === invoice.issuerOrg);
  return {
    id: invoice.id,
    issuerOrg: invoice.issuerOrg,
    issuerVerified: issuer?.kybStatus === 'full',
    amountUsd: invoice.amountUsd,
    targetCurrency: invoice.targetCurrency,
    dueDate: invoice.dueDate,
    memo: invoice.memo,
    status: invoice.status,
    paymentReference: invoice.paymentReference ?? `SPL-${slug.toUpperCase()}-${invoice.id.slice(-4).toUpperCase()}`,
    bankInstructions: BANK_TRANSFER_INSTRUCTIONS,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const invoice = publicInvoice(slug);
  return invoice
    ? NextResponse.json(invoice)
    : NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const invoice = findInvoiceBySlug(slug);
  if (!invoice) return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
  const parsed = paidSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Valid payer details are required' }, { status: 400 });

  const recipient = upsertRecipientFromInvoice({
    name: parsed.data.payerOrgName,
    orgEmail: parsed.data.payerOrgEmail,
  });
  updateInvoice(invoice.id, {
    payerOrgName: parsed.data.payerOrgName,
    payerOrgEmail: parsed.data.payerOrgEmail,
    paymentReference: parsed.data.paymentReference,
    status: 'paid',
  });
  const counterpartyPull = recordAnalyticsEvent('counterparty_pull');
  console.info('[kyb-invite] prepared', { recipientId: recipient.id, email: recipient.orgEmail });
  return NextResponse.json({ ok: true, recipientId: recipient.id, counterpartyPull });
}
