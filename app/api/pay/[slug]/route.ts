import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJsonBody } from '@/lib/server/http';
import { findInvoiceBySlug, recordAnalyticsEvent, updateInvoice } from '@/lib/server/operations';
import { findIssuerForPayLink, upsertRecipientFromInvoice } from '@/lib/server/recipients-store';

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

async function publicInvoice(slug: string) {
  const invoice = findInvoiceBySlug(slug);
  if (!invoice) return null;
  const issuer = await findIssuerForPayLink(invoice.issuerOrg);
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
  const invoice = await publicInvoice(slug);
  return invoice
    ? NextResponse.json(invoice)
    : NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const invoice = findInvoiceBySlug(slug);
  if (!invoice) return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
  const parsed = paidSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Valid payer details are required' }, { status: 400 });

  // The payer becomes a beneficiary of the ISSUING org, so the issuer's org is
  // what this record must belong to. `InvoiceRecord` has no org id yet, so it
  // is recovered from the issuer — and when it cannot be, no beneficiary is
  // created rather than an ownerless one that every tenant could read.
  const issuer = await findIssuerForPayLink(invoice.issuerOrg);
  const recipient = issuer
    ? await upsertRecipientFromInvoice({
        orgId: issuer.orgId,
        name: parsed.data.payerOrgName,
        orgEmail: parsed.data.payerOrgEmail,
      })
    : null;
  updateInvoice(invoice.id, {
    payerOrgName: parsed.data.payerOrgName,
    payerOrgEmail: parsed.data.payerOrgEmail,
    paymentReference: parsed.data.paymentReference,
    status: 'paid',
  });
  const counterpartyPull = recordAnalyticsEvent('counterparty_pull');
  if (recipient) {
    console.info('[kyb-invite] prepared', { recipientId: recipient.id, email: recipient.orgEmail });
  }
  // The payment is recorded either way — a missing issuer record must not lose
  // the payer's declaration that they have paid.
  return NextResponse.json({ ok: true, recipientId: recipient?.id ?? null, counterpartyPull });
}
