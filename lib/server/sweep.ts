import {
  createLedgerEntry,
  createSweepJob,
  findRecipient,
  readTransferIntent,
  updateSweepJob,
  updateTransferIntent,
} from '@/lib/server/operations';
import { pdaxAdapter } from '@/lib/server/pdax';

export async function completeDeliveryForTransfer(intentId: string) {
  const intent = readTransferIntent(intentId);
  if (!intent) throw new Error('Transfer intent not found');
  const accountId = intent.recipientId ?? intent.recipientName;

  if (intent.deliveryTier === 'PAYOUT_ONLY') {
    updateTransferIntent(intent.id, { state: 'DISBURSED' });
    return { state: 'DISBURSED' as const };
  }

  createLedgerEntry({
    accountId,
    direction: 'CREDIT',
    amountUsdcMicro: intent.stablecoinAmountMicro,
    refType: 'TRANSFER',
    refId: intent.id,
    suiTxDigest: intent.suiTxDigest ?? undefined,
  });
  if (intent.deliveryTier === 'STORED_BALANCE') {
    updateTransferIntent(intent.id, { state: 'CREDITED' });
    return { state: 'CREDITED' as const };
  }

  if (process.env.SWEEP_ACCOUNT_ENABLED === 'false') throw new Error('Sweep accounts are disabled');
  const recipient = intent.recipientId ? findRecipient(intent.recipientId) : null;
  const quote = await pdaxAdapter.quote(intent.targetCurrency, intent.stablecoinAmountMicro);
  const job = createSweepJob({
    transferIntentId: intent.id,
    recipientId: recipient?.id ?? accountId,
    partner: 'PDAX',
    amountUsdcMicro: intent.stablecoinAmountMicro,
    targetCurrency: intent.targetCurrency,
    fxRate: quote.fxRate,
  });
  updateTransferIntent(intent.id, { state: 'SWEEPING', sweepJobId: job.id });
  updateSweepJob(job.id, { state: 'EXECUTING' });

  try {
    const result = await pdaxAdapter.payout(job);
    const completedAt = new Date();
    const heldDurationMs = completedAt.getTime() - new Date(job.createdAt).getTime();
    createLedgerEntry({ accountId, direction: 'DEBIT', amountUsdcMicro: intent.stablecoinAmountMicro, refType: 'SWEEP', refId: job.id, suiTxDigest: intent.suiTxDigest ?? undefined });
    updateSweepJob(job.id, { state: 'COMPLETED', partnerPayoutRef: result.partnerPayoutRef, heldDurationMs, completedAt: completedAt.toISOString() });
    updateTransferIntent(intent.id, { state: 'DISBURSED' });
    return { state: 'DISBURSED' as const, heldDurationMs, partnerPayoutRef: result.partnerPayoutRef };
  } catch (error) {
    updateSweepJob(job.id, { state: 'FAILED' });
    updateTransferIntent(intent.id, { state: 'FAILED', failedAtState: 'SWEEPING', failureReason: error instanceof Error ? error.message : 'Sweep failed' });
    throw error;
  }
}
