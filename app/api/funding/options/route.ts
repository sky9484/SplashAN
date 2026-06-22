import { NextResponse } from 'next/server';

import { getEnabledFundingOptions, suggestedUsdProvider } from '@/lib/funding/registry';

export async function GET(request: Request) {
  const registry = getEnabledFundingOptions();
  const countryCode = request.headers.get('x-vercel-ip-country')
    ?? request.headers.get('cf-ipcountry')
    ?? request.headers.get('x-country-code');

  return NextResponse.json({
    ...registry,
    suggestedUsdProvider: suggestedUsdProvider(countryCode, registry),
    countryCode: countryCode?.toUpperCase() ?? null,
    demoMode: process.env.NODE_ENV !== 'production' || process.env.USE_MOCK_APIS === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
  });
}
