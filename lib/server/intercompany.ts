// lib/server/intercompany.ts
// Tracks intercompany USD transfers from Splash US → Splash Labuan
// and Labuan settlement confirmations for audit trail.

export type IntercompanyState =
  | 'INITIATED'
  | 'FX_CONFIRMED'
  | 'USD_SENT'       // USD transferred to Maybank Labuan
  | 'USD_RECEIVED'   // Splash Labuan confirms USD receipt
  | 'USDC_ACQUIRED'  // Splash Labuan has acquired USDC
  | 'SETTLED'        // USDC settled on Sui
  | 'FAILED';

export interface IntercompanyRecord {
  id: string;
  transferIntentId: string;    // links to operations.ts TransferIntentRecord
  amountUsd: string;
  amountUsdc: string;
  usdToUsdcRate: string;
  maybankRef: string;          // Maybank intercompany transfer reference
  labuanSettlementId: string;  // Splash Labuan's internal settlement ID
  state: IntercompanyState;
  createdAt: string;
  updatedAt: string;
}

type IntercompanyStore = Map<string, IntercompanyRecord>;
const globalStore = globalThis as typeof globalThis & { splashIntercompany?: IntercompanyStore };
export const intercompanyStore = globalStore.splashIntercompany ?? new Map<string, IntercompanyRecord>();
globalStore.splashIntercompany = intercompanyStore;

function uid() {
  return `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createIntercompanyTransfer(input: {
  transferIntentId: string;
  amountUsd: string;
  usdToUsdcRate: string;
}): IntercompanyRecord {
  const now = new Date().toISOString();
  const record: IntercompanyRecord = {
    id: uid(),
    transferIntentId: input.transferIntentId,
    amountUsd: input.amountUsd,
    amountUsdc: '0',
    usdToUsdcRate: input.usdToUsdcRate,
    maybankRef: '',
    labuanSettlementId: '',
    state: 'INITIATED',
    createdAt: now,
    updatedAt: now,
  };
  intercompanyStore.set(record.id, record);
  return record;
}

export function updateIntercompany(id: string, patch: Partial<IntercompanyRecord>): void {
  const record = intercompanyStore.get(id);
  if (!record) return;
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  intercompanyStore.set(id, record);
}

export function getIntercompanyByTransfer(transferIntentId: string): IntercompanyRecord | null {
  for (const record of intercompanyStore.values()) {
    if (record.transferIntentId === transferIntentId) return record;
  }
  return null;
}

export function listIntercompanyTransfers(): IntercompanyRecord[] {
  return [...intercompanyStore.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Daily reconciliation: sum USD in, USDC settled.
 * Returns discrepancy if any.
 */
export function getDailyReconciliation(dateStr?: string): {
  date: string;
  totalUsdIn: number;
  totalUsdcSettled: number;
  transferCount: number;
  discrepancy: number;
} {
  const targetDate = dateStr ?? new Date().toISOString().split('T')[0];
  let totalUsd = 0;
  let totalUsdc = 0;
  let count = 0;

  for (const record of intercompanyStore.values()) {
    if (record.createdAt.startsWith(targetDate)) {
      totalUsd += Number.parseFloat(record.amountUsd) || 0;
      totalUsdc += Number.parseFloat(record.amountUsdc) || 0;
      count++;
    }
  }

  // Discrepancy = USD out minus USDC in (should be near zero, difference is fees)
  const discrepancy = Math.abs(totalUsd - totalUsdc);

  return {
    date: targetDate,
    totalUsdIn: totalUsd,
    totalUsdcSettled: totalUsdc,
    transferCount: count,
    discrepancy,
  };
}
