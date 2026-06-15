import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { readAuditReceipt, readInvoice, readSweepJob, readTransferIntent } from '@/lib/server/operations';
import { readSealPolicy, sealAdapter } from '@/lib/server/seal';
import { retrieveBlob } from '@/lib/server/walrus';

function auditView(intentId: string) {
  const transfer = readTransferIntent(intentId);
  const receipt = readAuditReceipt(intentId);
  if (!transfer || !receipt) return null;
  const invoice = receipt.invoiceId ? readInvoice(receipt.invoiceId) : null;
  const sweepJob = receipt.sweepJobId ? readSweepJob(receipt.sweepJobId) : null;
  const policy = receipt.sealPolicyId ? readSealPolicy(receipt.sealPolicyId) : null;
  return { transfer, receipt, invoice, sweepJob, policy };
}

export async function GET(_request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const view = auditView(intentId);
  return view ? NextResponse.json(view) : NextResponse.json({ error: 'Audit receipt not found' }, { status: 404 });
}

export async function POST(_request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const view = auditView(intentId);
  if (!view?.invoice) return NextResponse.json({ error: 'Invoice proof not found' }, { status: 404 });
  if (view.invoice.demo && view.invoice.documentSha256?.startsWith('demo')) {
    return NextResponse.json({ verified: true, hash: view.invoice.documentSha256 });
  }
  if (!view.invoice.walrusBlobId || !view.invoice.sealPolicyId || !view.invoice.documentSha256) {
    return NextResponse.json({ error: 'Incomplete proof chain' }, { status: 409 });
  }
  const blob = await retrieveBlob(view.invoice.walrusBlobId);
  if (!blob) return NextResponse.json({ error: 'Walrus blob not found' }, { status: 404 });
  const plaintext = await sealAdapter.decrypt(blob.encryptedData, view.invoice.sealPolicyId, view.invoice.issuerOrg);
  if (!plaintext) return NextResponse.json({ error: 'Seal access denied' }, { status: 403 });
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return NextResponse.json({ verified: hash === view.invoice.documentSha256, hash });
}
