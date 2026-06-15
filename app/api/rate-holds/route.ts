import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCorridorFeeBps } from '@/lib/fx/corridors';
import { createRateHold, listRateHolds, readRateHold } from '@/lib/server/operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  corridorCurrency: z.string().trim().length(3),
  rate: z.coerce.number().positive(),
});

export async function GET(request: Request) {
  const holdId = new URL(request.url).searchParams.get('id');
  if (holdId) {
    const hold = readRateHold(holdId);
    return hold
      ? NextResponse.json(hold)
      : NextResponse.json({ error: 'Rate hold not found' }, { status: 404 });
  }
  return NextResponse.json({ items: listRateHolds() });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid corridor and rate are required' }, { status: 400 });
  }
  const corridorCurrency = parsed.data.corridorCurrency.toUpperCase();
  const hold = createRateHold({
    corridorCurrency,
    rate: String(parsed.data.rate),
    feeBps: getCorridorFeeBps(corridorCurrency),
  });
  return NextResponse.json(hold, { status: 201 });
}
