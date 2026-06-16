import { createHash } from 'node:crypto';

import { sealAdapter } from '@/lib/server/seal';
import {
  confirmComposedPaymentOnSui,
  createPaymentIntentOnSui,
} from '@/lib/server/sui-settlement';
import { storeEncryptedInvoice } from '@/lib/server/walrus';

function scaleFxRate(rate: string | number | null | undefined) {
  const parsed = Number(rate);
  return Math.max(1, Math.round((Number.isFinite(parsed) ? parsed : 1) * 1_000_000));
}

function treasuryAllocation(paymentMist: number) {
  const bps = Math.max(
    0,
    Math.min(10_000, Number.parseInt(process.env.COMPOSED_TREASURY_ALLOCATION_BPS ?? '100', 10) || 0),
  );
  return Math.floor(paymentMist * bps / 10_000);
}

export async function executeComposedPayment(input: {
  transferId: string;
  recipientAddress: string;
  recipientLabel: string;
  amountMist: number;
  targetCurrency: string;
  fxRate: string | number | null | undefined;
}) {
  const paymentMist = Math.max(1, Math.floor(input.amountMist));
  const intent = await createPaymentIntentOnSui({
    recipient: input.recipientAddress,
    amountMist: paymentMist,
    targetCurrency: input.targetCurrency,
    fxRateScaled: scaleFxRate(input.fxRate),
  });

  const auditPayload = JSON.stringify({
    schema: 'splash.composed-payment.v1',
    transferId: input.transferId,
    paymentIntentId: intent.intentId,
    intentCreateDigest: intent.digest,
    recipient: input.recipientLabel,
    targetCurrency: input.targetCurrency,
    paymentMist,
    createdAt: new Date().toISOString(),
  });
  const { ciphertext, policy } = await sealAdapter.encrypt(auditPayload, [
    'dashboard-operator',
    input.recipientLabel,
    'auditor',
  ]);
  const blob = await storeEncryptedInvoice(ciphertext);
  const auditHash = createHash('sha256').update(ciphertext).digest('hex');
  const composed = await confirmComposedPaymentOnSui({
    intentId: intent.intentId,
    intentCreateDigest: intent.digest,
    paymentMist,
    treasuryAmountMist: treasuryAllocation(paymentMist),
    auditHash,
    anchorId: `transfer:${input.transferId}`,
    backingBlobId: blob.blobId,
  });

  return {
    ...composed,
    auditHash,
    walrus: blob,
    sealPolicy: policy,
  };
}
