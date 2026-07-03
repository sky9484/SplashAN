import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { verifyStoredSettlementEvidence } from '@/lib/evidence/settlement';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
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

async function settlementProof(view: NonNullable<ReturnType<typeof auditView>>) {
  const evidence = view.receipt.evidence;
  const proof = await verifyStoredSettlementEvidence({
    walrusBlobId: evidence?.walrusBlobId ?? view.receipt.walrusBlobId,
    sealPolicyId: evidence?.sealPolicyId ?? view.receipt.sealPolicyId,
    expectedCiphertextHash: evidence?.ciphertextHash ?? view.receipt.auditHash,
    auditEventId: view.receipt.auditAnchorId,
    suiDigest: view.receipt.auditAnchorDigest ?? view.receipt.suiTxDigest,
  });
  return {
    receipt: {
      recipient: view.transfer.recipientName,
      sent: `USD ${view.transfer.sourceAmountUsd}`,
      delivered: `${view.transfer.targetCurrency} ${view.transfer.targetAmount}`,
      rate: view.transfer.exchangeRate,
      feeTier: view.receipt.funding?.feeTier ?? view.transfer.fundingFeeTier,
      status: view.transfer.state,
      source: view.receipt.funding?.method ?? view.transfer.fundingMethod,
      reference: view.transfer.invoiceId ?? view.transfer.id,
      time: view.transfer.updatedAt,
    },
    independent: proof,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { intentId } = await params;
  const view = auditView(intentId);
  return view
    ? NextResponse.json({ ...view, proof: await settlementProof(view) })
    : NextResponse.json({ error: 'Audit receipt not found' }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { intentId } = await params;
  const view = auditView(intentId);
  const settlement = view ? await settlementProof(view) : null;
  if (!view?.invoice) return NextResponse.json({ error: 'Invoice proof not found' }, { status: 404 });
  if (view.invoice.demo && view.invoice.documentSha256?.startsWith('demo')) {
    return NextResponse.json({ verified: true, hash: view.invoice.documentSha256, settlement });
  }
  if (!view.invoice.walrusBlobId || !view.invoice.sealPolicyId || !view.invoice.documentSha256) {
    return NextResponse.json({ error: 'Incomplete proof chain', settlement }, { status: 409 });
  }
  const blob = await retrieveBlob(view.invoice.walrusBlobId);
  if (!blob) return NextResponse.json({ error: 'Walrus blob not found' }, { status: 404 });
  const plaintext = await sealAdapter.decrypt(blob.encryptedData, view.invoice.sealPolicyId, view.invoice.issuerOrg);
  if (!plaintext) return NextResponse.json({ error: 'Seal access denied' }, { status: 403 });
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return NextResponse.json({ verified: hash === view.invoice.documentSha256, hash, settlement });
}
