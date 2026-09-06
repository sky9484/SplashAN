import { NextResponse } from 'next/server';

import {
  buildFundingSources,
  getEnabledFundingOptions,
  selectionForSource,
  suggestedUsdProvider,
  type FundingSourceId,
} from '@/lib/funding/registry';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { getLedgerBalance } from '@/lib/server/operations';
import { readLastUsedFundingSource } from '@/lib/server/funding-sessions';
import { isForeignAccountId, resolveSessionAccount } from '@/lib/server/session-account';
import { authorityErrorResponse } from '@/lib/server/authority-response';

export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const amountUsd = Number.parseFloat(url.searchParams.get('amountUsd') ?? '0');
  const amountDueMicro = Number.isFinite(amountUsd) && amountUsd > 0 ? Math.round(amountUsd * 1_000_000) : 0;
  // Derived from the session, not the query string — this response discloses a
  // spendable balance, so a client-named account is a balance oracle for any
  // org whose account id you can guess.
  let businessAccountId: string;
  try {
    ({ accountId: businessAccountId } = await resolveSessionAccount(auth.session));
  } catch (error) {
    // A signed-in person with no membership is a 403 with a reason, not a 500
    // that the desk renders as "Funding sources are unavailable".
    const denied = authorityErrorResponse(error);
    if (denied) return denied;
    throw error;
  }
  if (isForeignAccountId(url.searchParams.get('businessAccountId'), businessAccountId)) {
    return NextResponse.json({ error: 'businessAccountId does not belong to this organization' }, { status: 403 });
  }
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
