import { NextResponse } from 'next/server';

import { getLedgerBalance, listLedgerEntries } from '@/lib/server/operations';

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get('accountId') ?? undefined;
  const entries = listLedgerEntries(accountId);
  const balanceMicro = accountId ? getLedgerBalance(accountId) : 0;
  return NextResponse.json({ accountId: accountId ?? null, entries, balanceMicro, balanceUsdc: (balanceMicro / 1_000_000).toFixed(2) });
}
