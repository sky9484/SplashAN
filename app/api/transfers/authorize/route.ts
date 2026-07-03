import { after, NextResponse } from 'next/server';
import { z } from 'zod';

import { createIntercompanyTransfer } from '@/lib/server/intercompany';
import { convertUsdToUsdc, usdCentsToUsdcMicro } from '@/lib/server/labuan-settlement';
import { executeComposedPayment } from '@/lib/server/composed-payment';
import {
  createLedgerEntry,
  createRecipient,
  createTransferIntent,
  getLedgerBalance,
  updateAuditReceipt,
  updateInvoice,
  updateTransferIntent,
} from '@/lib/server/operations';
import { pythAdapter } from '@/lib/server/pyth';
import { calculateQuote } from '@/lib/server/quote';
import { completeDeliveryForTransfer } from '@/lib/server/sweep';
import { confirmUsdFunding } from '@/lib/server/funding-intake';
import { readFundingSession, recordLastUsedFundingSource, updateFundingSession } from '@/lib/server/funding-sessions';
import {
  FundingRegistryError,
  fundingMethodForSelection,
  resolveFundingSelection,
  type FundingSelection,
} from '@/lib/funding/registry';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

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
  businessAccountId: z.string().trim().min(1).optional(),
  fundingSelection: z.discriminatedUnion('type', [
    z.object({
      source: z.literal('SPLASH_BALANCE'),
      type: z.literal('held'),
      feeTier: z.literal('DISCOUNT'),
    }),
    z.object({
      source: z.literal('BANK_USD'),
      type: z.literal('fiat'),
      provider: z.enum(['STRIPE', 'AIRWALLEX']),
      feeTier: z.literal('STANDARD'),
    }),
    z.object({
      source: z.enum(['USDC', 'USDSUI', 'USDT']),
      type: z.literal('stablecoin'),
      asset: z.enum(['USDC', 'USDSUI', 'USDT']),
      rail: z.enum(['SUI_NATIVE', 'CCTP']),
      sourceChain: z.enum(['ETHEREUM', 'SOLANA', 'BASE', 'ARBITRUM']).optional(),
      feeTier: z.literal('DISCOUNT'),
    }),
  ]).optional(),
  totp: z.string().optional(),
  kycTier: z.union([z.number(), z.string()]).optional(),
});

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const parsed = authorizeSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid transfer authorization' }, { status: 400 });
  const body = parsed.data;
  const totp = String(body.totp ?? '');
  const paymentRail = String(body.paymentRail ?? 'STRIPE_CHECKOUT');
  if (!body.fundingSessionId && body.fundingSelection?.type !== 'held' && paymentRail !== 'STRIPE_CHECKOUT' && paymentRail !== 'AIRWALLEX_WIRE' && !/^\d{6}$/.test(totp)) {
    return NextResponse.json({ error: 'A valid 6-digit authorization code is required' }, { status: 400 });
  }

  const sourceAmount = Number.parseFloat(body.amount.value);
  const sourceAmountCents = Math.round(sourceAmount * 100);
  const sourceAmountMicro = Math.round(sourceAmount * 1_000_000);
  const businessAccountId = body.businessAccountId
    ?? process.env.SPLASH_BUSINESS_ACCOUNT_ID
    ?? 'dashboard-primary';
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
  let fundingSelection: FundingSelection | null = fundingSession?.selection ?? (body.fundingSelection as FundingSelection | undefined) ?? null;
  if (!fundingSelection) {
    return NextResponse.json({ error: 'Payment source is required' }, { status: 400 });
  }
  try {
    resolveFundingSelection(fundingSelection);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Payment source is unavailable' },
      { status: error instanceof FundingRegistryError ? 400 : 503 },
    );
  }
  if (!Number.isSafeInteger(sourceAmountMicro) || sourceAmountMicro <= 0) {
    return NextResponse.json({ error: 'A positive source amount is required' }, { status: 400 });
  }
  if (!fundingSession && fundingSelection.type !== 'held') {
    return NextResponse.json({ error: 'Bank and coin sources require a funding session before settlement' }, { status: 409 });
  }
  if (fundingSelection.type === 'held' && getLedgerBalance(businessAccountId) < sourceAmountMicro) {
    return NextResponse.json({ error: 'Splash balance is insufficient for this payment source' }, { status: 409 });
  }
  if (fundingSelection.type === 'fiat' && fundingSession) {
    try {
      fundingSession = confirmUsdFunding(fundingSession.id);
      fundingSelection = fundingSession.selection;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'USD provider confirmation is pending' },
        { status: 409 },
      );
    }
  }
  if (fundingSelection.type === 'stablecoin' && fundingSession?.status !== 'CREDITED') {
    return NextResponse.json({ error: `Coin source is ${fundingSession?.status ?? 'not ready'}; settlement cannot start` }, { status: 409 });
  }
  const feeTier = fundingSelection.feeTier;
  const serverQuote = sourceAmountCents > 0
    ? await calculateQuote(sourceAmountCents, undefined, body.amount.targetCurrency, feeTier)
    : null;
  const pegStatus = await pythAdapter.getPegStatus();
  if (!pegStatus.pegged) {
    return NextResponse.json({ error: `Settlement blocked: stablecoin peg deviation too high (${pegStatus.deviationPpm} ppm).` }, { status: 409 });
  }

  const stablecoinAmountMicro = fundingSelection.type === 'stablecoin'
    ? fundingSession!.normalizedAmountUsdcMicro ?? 0
    : fundingSelection.type === 'held'
      ? sourceAmountMicro
    : sourceAmountCents > 0 ? await usdCentsToUsdcMicro(sourceAmountCents) : 0;
  const conversion = fundingSelection.type === 'stablecoin' || fundingSelection.type === 'held'
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
    fundingSource: fundingSelection.source,
    fundingMethod: fundingMethodForSelection(fundingSelection),
    fundingProvider: fundingSelection.type === 'fiat' ? fundingSelection.provider : undefined,
    fundingAsset: fundingSelection.type === 'stablecoin' ? fundingSelection.asset : undefined,
    fundingRail: fundingSelection.type === 'stablecoin' ? fundingSelection.rail : undefined,
    fundingSourceChain: fundingSelection.type === 'stablecoin' ? fundingSelection.sourceChain : undefined,
    fundingFeeTier: feeTier,
    fundingKytStatus: fundingSelection.type === 'stablecoin' ? fundingSession?.status : undefined,
    fundingNormalizeVenue: fundingSession?.normalizeVenue,
    fundingEffectiveSlippageBps: fundingSession?.effectiveSlippageBps,
  });
  if (fundingSession) updateFundingSession(fundingSession.id, { transferIntentId: intent.id });
  if (fundingSelection.type === 'held') {
    createLedgerEntry({
      accountId: businessAccountId,
      direction: 'DEBIT',
      amountUsdcMicro: sourceAmountMicro,
      refType: 'TRANSFER',
      refId: intent.id,
      demo: process.env.NODE_ENV !== 'production' || process.env.USE_MOCK_APIS === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
    });
  }
  recordLastUsedFundingSource(fundingSession?.businessAccountId ?? businessAccountId, fundingSelection.source);
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
          source: intent.fundingSource,
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
        evidence: result.evidence,
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
      source: intent.fundingSource,
      method: intent.fundingMethod,
      feeTier: intent.fundingFeeTier,
      sessionId: intent.fundingSessionId,
    },
  });
}
