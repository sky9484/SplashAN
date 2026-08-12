import { after, NextResponse } from 'next/server';

import { assertCleanBody, ProvenanceViolationError, provenanceViolationResponse } from '@/lib/auth/provenance-guard';
import { requireActiveOrg } from '@/lib/server/kyb-gate';
import { checkMinimumSettlement } from '@/lib/policy/limits';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { createBatch, updateBatch } from '@/lib/server/operations';
import { recordBatchSettlementOnSui } from '@/lib/server/sui-settlement';

export const maxDuration = 60;

type BatchRow = {
  name?: string;
  address?: string;
  amount?: string;
};

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  try {
    assertCleanBody(body, 'batches/authorize');
  } catch (error) {
    if (error instanceof ProvenanceViolationError) return provenanceViolationResponse(error);
    throw error;
  }
  const gate = await requireActiveOrg(auth.session);
  if (gate.response) return gate.response;

  const rows = Array.isArray(body.rows) ? (body.rows as BatchRow[]) : [];
  const totp = String(body.totp ?? '');
  const targetCurrency = typeof body.targetCurrency === 'string' ? body.targetCurrency : 'PHP';

  if (!/^\d{6}$/.test(totp)) {
    return NextResponse.json({ error: 'A valid 6-digit authorization code is required' }, { status: 400 });
  }

  const acceptedRows = rows.filter((row) => row.name && row.address && Number.parseFloat(String(row.amount ?? '0')) > 0);
  const total = acceptedRows.reduce((sum, row) => sum + Number.parseFloat(String(row.amount ?? '0')), 0);

  // Minimum applies to the batch TOTAL, not per row — a payroll run legitimately
  // contains small individual rows. Checked before the batch record is created
  // so a sub-minimum run never enters the operations store.
  const minimum = checkMinimumSettlement(total, 'batch');
  if (!minimum.ok) {
    return NextResponse.json(
      { error: minimum.message, code: 'below_minimum', minimumUsd: minimum.minimumUsd },
      { status: 400 },
    );
  }
  const batch = createBatch({
    rowCount: rows.length,
    acceptedRows: acceptedRows.length,
    blockedRows: rows.length - acceptedRows.length,
    totalAmount: total.toFixed(2),
  });

  // Fire Sui settlement after responding so the HTTP round-trip is instant.
  after(async () => {
    updateBatch(batch.id, { state: 'SETTLING' });
    try {
      const result = await recordBatchSettlementOnSui({
        batchId: batch.id,
        rows: acceptedRows,
        totalUsd: total,
        // Per-corridor fee — contract enforces fee_bps ≤ MAX_FEE_BPS (200).
        targetCurrency,
      });
      // Batch may run in labelled-simulate mode (SUI_BATCH_SETTLEMENT_MODE=simulate):
      // its SIM_ digest has no on-chain tx, so don't emit explorer links that 404.
      const simulated = (result as { simulated?: boolean }).simulated === true;
      updateBatch(batch.id, {
        state: 'SETTLED',
        digest: result.digest,
        packageId: result.packageId,
        demo: simulated,
        explorer: simulated
          ? { suiVisionTxUrl: null, suiScanTxUrl: null }
          : {
              suiVisionTxUrl: `https://testnet.suivision.xyz/txblock/${result.digest}`,
              suiScanTxUrl: `https://suiscan.xyz/testnet/tx/${result.digest}`,
            },
      });
    } catch (error) {
      updateBatch(batch.id, {
        state: 'FAILED',
      });
      console.error('[Batch Settlement] Failed:', error instanceof Error ? error.message : error);
    }
  });

  return NextResponse.json(batch);
}
