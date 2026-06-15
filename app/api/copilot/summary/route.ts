import { NextResponse } from 'next/server';

import { listInvoices } from '@/lib/server/operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const invoices = listInvoices();
  const openInvoices = invoices.filter((invoice) => invoice.status !== 'paid' && invoice.status !== 'settled');
  const corridorCounts = openInvoices.reduce<Record<string, number>>((counts, invoice) => {
    counts[invoice.targetCurrency] = (counts[invoice.targetCurrency] ?? 0) + 1;
    return counts;
  }, {});
  const batchable = Object.values(corridorCounts).reduce((total, count) => total + (count >= 2 ? count : 0), 0);
  const needsApproval = invoices.filter((invoice) => invoice.status === 'overdue').length;

  return NextResponse.json({ detected: invoices.length, batchable, needsApproval });
}
