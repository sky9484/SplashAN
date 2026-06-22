import { after, NextResponse } from 'next/server';
import { z } from 'zod';

import { createIntercompanyTransfer } from '@/lib/server/intercompany';
import { convertUsdToUsdc, usdCentsToUsdcMicro } from '@/lib/server/labuan-settlement';
import { executeComposedPayment } from '@/lib/server/composed-payment';
import {
  createRecipient,
  createTransferIntent,
  updateAuditReceipt,
  updateInvoice,
  updateTransferIntent,
} from '@/lib/server/operations';
import { pythAdapter } from '@/lib/server/pyth';
import { calculateQuote } from '@/lib/server/quote';
import { completeDeliveryForTransfer } from '@/lib/server/sweep';
import { confirmUsdFunding } from '@/lib/server/funding-intake';
import { readFundingSession, updateFundingSession } from '@/lib/server/funding-sessions';

export const maxDuration = 60;

const authorizeSchema = z.object({
  recipient: z.object({
    name: z.string().trim().min(2),
    country: z.string().trim().min(2),
    bank: z.object({ swift: z.string().optional(), account: z.string().trim().min(1) }).optional(),
  }),
  amount: z.object({ value: z.string(), targetCurrency: z.string().length(3) }),
  quote: z.object({ netReceived: z.string() }).optional(),
  deliveryTier: z.enum(['PAYOUT_ONLY', 'SWEEP_ACCOUNT', 'STORED_BALANCE']).default('PAYOUT_ONLY'),
  invoiceId: z.string().optional(),
  paymentRail: z.string().optional(),
  fundingSessionId: z.string().optional(),
  totp: z.string().optional(),
  kycTier: z.union([z.number(), z.string()]).optional(),
});

export async function POST(request: Request) {
  const parsed = authorizeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid transfer authorization' }, { status: 400 });
  const body = parsed.data;
  const totp = String(body.totp ?? '');
  const paymentRail = String(body.paymentRail ?? 'STRIPE_CHECKOUT');
  if (!body.fundingSessionId && paymentRail !== 'STRIPE_CHECKOUT' && paymentRail !== 'AIRWALLEX_WIRE' && !/^\d{6}$/.test(totp)) {
    return NextResponse.json({ error: 'A valid 6-digit authorization code is required' }, { status: 400 });
  }

  const sourceAmount = Number.parseFloat(body.amount.value);
  const sourceAmountCents = Math.round(sourceAmount * 100);
  let fundingSession = body.fundingSessionId ? readFundingSession(body.fundingSessionId) : null;
  if (body.fundingSessionId && !fundingSession) {
    return NextResponse.json({ error: 'Funding session not found' }, { status: 404 });
  }
  if (fundingSession?.transferIntentId) {
    return NextResponse.json({ error: 'Funding session is already bound to a transfer' }, { status: 409 });
  }
  if (fundingSession && Math.abs(fundingSession.amountExpectedMicro - Math.round(sourceAmount * 1_000_000)) > 1) {
    return NextResponse.json({ error: 'Funding session amount does not match the transfer' }, { status: 409 });
  }
  if (fundingSession?.selection.method === 'USD') {
    try {
      fundingSession = confirmUsdFunding(fundingSession.id);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'USD provider confirmation is pending' },
        { status: 409 },
      );
    }
  }
  if (fundingSession?.selection.method === 'STABLECOIN' && fundingSession.status !== 'CREDITED') {
    return NextResponse.json({ error: `Stablecoin funding is ${fundingSession.status}; settlement cannot start` }, { status: 409 });
  }
  const feeTier = fundingSession?.feeTier ?? 'STANDARD';
  const serverQuote = sourceAmountCents > 0
    ? await calculateQuote(sourceAmountCents, undefined, body.amount.targetCurrency, feeTier)
    : null;
  const pegStatus = await pythAdapter.getPegStatus();
  if (!pegStatus.pegged) {
    return NextResponse.json({ error: `Settlement blocked: stablecoin peg deviation too high (${pegStatus.deviationPpm} ppm).` }, { status: 409 });
  }

  const stablecoinAmountMicro = fundingSession?.selection.method === 'STABLECOIN'
    ? fundingSession.normalizedAmountUsdcMicro ?? 0
    : sourceAmountCents > 0 ? await usdCentsToUsdcMicro(sourceAmountCents) : 0;
  const conversion = fundingSession?.selection.method === 'STABLECOIN'
    ? null
    : sourceAmount > 0 ? await convertUsdToUsdc(sourceAmount) : null;
  const sourceStablecoin = 'USDC' as const;
  const recipient = createRecipient({
    name: body.recipient.name,
    country: body.recipient.country,
    swift: body.recipient.bank?.swift,
    account: body.recipient.bank?.account,
    tier: body.deliveryTier,
  });
  const intent = createTransferIntent({
    recipientName: recipient.name,
    recipientId: recipient.id,
    invoiceId: body.invoiceId,
    deliveryTier: body.deliveryTier,
    targetCurrency: serverQuote?.targetCurrency ?? body.amount.targetCurrency,
    targetAmount: serverQuote ? serverQuote.toAmount.toFixed(2) : body.quote?.netReceived ?? '0.00',
    sourceAmountUsd: Number.isFinite(sourceAmount) ? sourceAmount.toFixed(2) : '0.00',
    quoteId: serverQuote?.quoteId ?? null,
    exchangeRate: serverQuote?.exchangeRate ?? null,
    sourceStablecoin,
    stablecoinAmountMicro,
    daxTier: conversion?.tier ?? null,
    pegChecked: true,
    fundingSessionId: fundingSession?.id,
    fundingMethod: fundingSession?.selection.method ?? 'USD',
    fundingProvider: fundingSession?.selection.method === 'USD' ? fundingSession.selection.provider : undefined,
    fundingAsset: fundingSession?.selection.method === 'STABLECOIN' ? fundingSession.selection.asset : undefined,
    fundingRail: fundingSession?.selection.method === 'STABLECOIN' ? fundingSession.selection.rail : undefined,
    fundingSourceChain: fundingSession?.selection.method === 'STABLECOIN' ? fundingSession.selection.sourceChain : undefined,
    fundingFeeTier: feeTier,
    fundingKytStatus: fundingSession?.selection.method === 'STABLECOIN' ? fundingSession.status : undefined,
    fundingNormalizeVenue: fundingSession?.normalizeVenue,
    fundingEffectiveSlippageBps: fundingSession?.effectiveSlippageBps,
  });
  if (fundingSession) updateFundingSession(fundingSession.id, { transferIntentId: intent.id });
  updateAuditReceipt(intent.id, {
    approvedBy: 'dashboard-operator',
    approvedAt: new Date().toISOString(),
  });
  if (body.invoiceId) updateInvoice(body.invoiceId, { transferIntentId: intent.id });

  if (conversion?.success && conversion.labuanSettlementId) {
    createIntercompanyTransfer({ transferIntentId: intent.id, amountUsd: conversion.usdAmount, usdToUsdcRate: conversion.usdToUsdcRate });
  }

  after(async () => {
    updateTransferIntent(intent.id, { state: 'QUEUED' });
    try {
      updateTransferIntent(intent.id, { state: 'SETTLING' });
      const result = await executeComposedPayment({
        transferId: intent.id,
        recipientAddress: '',
        recipientLabel: intent.recipientName,
        amountMist: Math.max(1_000_000, stablecoinAmountMicro),
        targetCurrency: serverQuote?.targetCurrency ?? body.amount.targetCurrency,
        fxRate: serverQuote?.exchangeRate ?? intent.exchangeRate,
        funding: {
          sessionId: intent.fundingSessionId,
          method: intent.fundingMethod,
          provider: intent.fundingProvider,
          asset: intent.fundingAsset,
          rail: intent.fundingRail,
          sourceChain: intent.fundingSourceChain,
          feeTier: intent.fundingFeeTier,
          kytStatus: intent.fundingKytStatus,
          normalizeVenue: intent.fundingNormalizeVenue,
          effectiveSlippageBps: intent.fundingEffectiveSlippageBps,
        },
      });
      updateTransferIntent(intent.id, {
        state: 'SETTLED',
        suiTxDigest: result.digest,
        verificationReference: result.digest,
        receiptObjectId: result.auditAnchorObjectId ?? undefined,
        paymentIntentId: result.intentId,
        intentCreateDigest: result.intentCreateDigest,
        walrusBlobId: result.walrus.blobId,
        sealPolicyId: result.sealPolicy.policyId,
        auditHash: result.auditHash,
        auditAnchorId: result.auditAnchorObjectId ?? undefined,
        smartTreasuryId: result.smartTreasuryId ?? undefined,
        composedActions: result.composedActions,
      });
      updateAuditReceipt(intent.id, {
        suiTxDigest: result.digest,
        paymentIntentId: result.intentId,
        intentCreateDigest: result.intentCreateDigest,
        walrusBlobId: result.walrus.blobId,
        sealPolicyId: result.sealPolicy.policyId,
        auditHash: result.auditHash,
        auditAnchorId: result.auditAnchorObjectId ?? undefined,
        auditAnchorDigest: result.digest,
        smartTreasuryId: result.smartTreasuryId ?? undefined,
        composedActions: result.composedActions,
      });
      await completeDeliveryForTransfer(intent.id);
    } catch (error) {
      updateTransferIntent(intent.id, {
        state: 'FAILED',
        failureReason: error instanceof Error ? error.message : 'Unknown settlement error',
        failedAtState: 'SETTLING',
      });
    }
  });

  return NextResponse.json({
    transferIntentId: intent.id,
    state: intent.state,
    quote: serverQuote,
    stablecoinUsed: sourceStablecoin,
    daxProvider: intent.daxProvider,
    daxTier: intent.daxTier,
    deliveryTier: intent.deliveryTier,
    funding: {
      method: intent.fundingMethod,
      feeTier: intent.fundingFeeTier,
      sessionId: intent.fundingSessionId,
    },
  });
}
