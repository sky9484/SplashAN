import { NextResponse } from 'next/server';

import { pythAdapter } from '@/lib/server/pyth';

export async function GET() {
  const pegStatus = await pythAdapter.getPegStatus();

  return NextResponse.json(pegStatus);
}
