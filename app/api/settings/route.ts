import { NextResponse } from 'next/server';

import { readOperatingSettings, saveOperatingSettings } from '@/lib/server/operating-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(readOperatingSettings());
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json(saveOperatingSettings(await request.json()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save operating settings.' },
      { status: 400 },
    );
  }
}
