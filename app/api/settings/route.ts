import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { readOperatingSettings, saveOperatingSettings } from '@/lib/server/operating-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  return NextResponse.json(readOperatingSettings());
}

export async function PUT(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json(saveOperatingSettings(await readJsonBody(request)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save operating settings.' },
      { status: 400 },
    );
  }
}
