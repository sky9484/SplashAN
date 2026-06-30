import { NextResponse } from 'next/server';

import {
  buildFundingSources,
  getEnabledFundingOptions,
  selectionForSource,
  suggestedUsdProvider,
  type FundingSourceId,
} from '@/lib/funding/registry';
import { getLedgerBalance } from '@/lib/server/operations';
import { readLastUsedFundingSource } from '@/lib/server/funding-sessions';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const amountUsd = Number.parseFloat(url.searchParams.get('amountUsd') ?? '0');
  const amountDueMicro = Number.isFinite(amountUsd) && amountUsd > 0 ? Math.round(amountUsd * 1_000_000) : 0;
  const businessAccountId = url.searchParams.get('businessAccountId')
    ?? process.env.SPLASH_BUSINESS_ACCOUNT_ID
    ?? 'dashboard-primary';
  const registry = getEnabledFundingOptions();
  const heldBalanceMicro = getLedgerBalance(businessAccountId);
  const sources = buildFundingSources({ registry, heldBalanceMicro, amountDueMicro });
  const lastUsedSource = readLastUsedFundingSource(businessAccountId);
  const countryCode = request.headers.get('x-vercel-ip-country')
    ?? request.headers.get('cf-ipcountry')
    ?? request.headers.get('x-country-code');
  const suggestedProvider = suggestedUsdProvider(countryCode, registry);
  const sourceIsEnabled = (source: FundingSourceId | null) => Boolean(source && sources.some((item) => item.id === source && item.enabled));
  const defaultSource = sources.find((source) => source.id === 'SPLASH_BALANCE' && source.enabled)?.id
    ?? (sourceIsEnabled(lastUsedSource) ? lastUsedSource : null)
    ?? sources.find((source) => source.id === 'BANK_USD' && source.enabled)?.id
    ?? sources.find((source) => source.enabled)?.id
    ?? null;

  return NextResponse.json({
    ...registry,
    sources,
    defaultSource,
    defaultSelection: defaultSource ? selectionForSource(defaultSource, registry, suggestedProvider) : null,
    heldBalanceMicro,
    heldBalanceUsdc: (heldBalanceMicro / 1_000_000).toFixed(2),
    lastUsedSource,
    businessAccountId,
    suggestedUsdProvider: suggestedProvider,
    countryCode: countryCode?.toUpperCase() ?? null,
    demoMode: process.env.NODE_ENV !== 'production' || process.env.USE_MOCK_APIS === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
  });
}
