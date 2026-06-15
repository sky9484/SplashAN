import { after, NextResponse } from 'next/server';

import { convertUsdToUsdc, usdCentsToUsdcMicro } from '@/lib/server/labuan-settlement';
import { createIntercompanyTransfer } from '@/lib/server/intercompany';
import { createTransferIntent, updateTransferIntent } from '@/lib/server/operations';
import { pythAdapter } from '@/lib/server/pyth';
import { calculateQuote } from '@/lib/server/quote';
import { selectStablecoin } from '@/lib/server/stable-router';
import { recordSingleTransferOnSui } from '@/lib/server/sui-settlement';

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json();
  const totp = String(body.totp ?? '');
  const paymentRail = String(body.paymentRail ?? 'STRIPE_CHECKOUT');

  if (paymentRail !== 'STRIPE_CHECKOUT' && paymentRail !== 'AIRWALLEX_WIRE' && !/^\d{6}$/.test(totp)) {
    return NextResponse.json({ error: 'A valid 6-digit authorization code is required' }, { status: 400 });
  }

  const recipient = body.recipient as { name?: string } | undefined;
  const amount = body.amount as { value?: string; targetCurrency?: string } | undefined;
  const quote = body.quote as { netReceived?: string } | undefined;
  const sourceAmount = Number.parseFloat(amount?.value ?? '0');
  const sourceAmountCents = Math.round(sourceAmount * 100);
  const serverQuote = sourceAmountCents > 0 ? await calculateQuote(sourceAmountCents, undefined, amount?.targetCurrency ?? 'PHP') : null;
  const pegStatus = await pythAdapter.getPegStatus();

  if (!pegStatus.pegged) {
    return NextResponse.json(
      {
        error: `Settlement blocked: stablecoin peg deviation too high (${pegStatus.deviationPpm} ppm).`,
      },
      { status: 409 },
    );
  }

  const stablecoinAmountMicro = sourceAmountCents > 0 ? await usdCentsToUsdcMicro(sourceAmountCents) : 0;
  const conversion = sourceAmount > 0 ? await convertUsdToUsdc(sourceAmount) : null;
  const usdcAvailableMicro = Number.parseInt(process.env.USDC_AVAILABLE_MICRO ?? '1000000000000000', 10);
  const usdtAvailableMicro = Number.parseInt(process.env.USDT_AVAILABLE_MICRO ?? '0', 10);
  const usdtBufferAgeMs = Number.parseInt(process.env.USDT_BUFFER_AGE_MS ?? '0', 10);
  const kycTier = Number.parseInt(String(body.kycTier ?? process.env.DEFAULT_KYC_TIER ?? '1'), 10);
  const sourceStablecoin = selectStablecoin({
    kycTier,
    usdcSpreadBps: 0,
    usdtSpreadBps: -pegStatus.spreadBps,
    usdcAvailableMicro,
    usdtAvailableMicro,
    transferAmountMicro: stablecoinAmountMicro,
    usdtBufferAgeMs,
  });

  const intent = createTransferIntent({
    recipientName: recipient?.name ?? 'Recipient',
    targetCurrency: serverQuote?.targetCurrency ?? amount?.targetCurrency ?? 'PHP',
    targetAmount: serverQuote ? serverQuote.toAmount.toFixed(2) : quote?.netReceived ?? '0.00',
    sourceAmountUsd: Number.isFinite(sourceAmount) ? sourceAmount.toFixed(2) : '0.00',
    quoteId: serverQuote?.quoteId ?? null,
    exchangeRate: serverQuote?.exchangeRate ?? null,
    sourceStablecoin,
    stablecoinAmountMicro,
    daxTier: conversion?.tier ?? null,
    pegChecked: true,
  });

  // Track intercompany transfer (Splash US -> Splash Labuan) for audit/reconciliation.
  if (conversion?.success && conversion.labuanSettlementId) {
    createIntercompanyTransfer({
      transferIntentId: intent.id,
      amountUsd: conversion.usdAmount,
      usdToUsdcRate: conversion.usdToUsdcRate,
    });
  }

  // Fire Sui settlement after responding so the HTTP round-trip is instant.
  after(async () => {
    updateTransferIntent(intent.id, { state: 'QUEUED' });
    try {
      const result = await recordSingleTransferOnSui({
        transferId: intent.id,
        recipient: '',
        amountUsd: sourceAmount,
        stablecoinAmountMicro,
        // Pass the corridor so settlement.move charges the correct fee_bps.
        targetCurrency: serverQuote?.targetCurrency ?? amount?.targetCurrency ?? 'PHP',
        feeBps: serverQuote?.feeBps,
      });
      updateTransferIntent(intent.id, {
        state: 'SETTLED',
        suiTxDigest: result.digest,
        verificationReference: result.digest,
        receiptObjectId: `receipt_${intent.id}`,
      });
    } catch (error) {
      updateTransferIntent(intent.id, {
        state: 'FAILED',
        failureReason: error instanceof Error ? error.message : 'Unknown Sui error',
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
  });
}
