import { NextResponse } from 'next/server';

import { calculateQuote } from '@/lib/server/quote';

export async function POST(request: Request) {
  const body = await request.json();
  const fromAmountSen = body.fromAmount === undefined
    ? Math.round(Number(body.amount ?? 0) * 100)
    : Math.round(Number(body.fromAmount ?? 0));
  const targetCurrency = String(body.targetCurrency ?? 'PHP');
  const recipientId = typeof body.recipientId === 'string' ? body.recipientId : undefined;
  const feeTier = body.fundingMethod === 'STABLECOIN' ? 'DISCOUNT' : 'STANDARD';

  if (!Number.isFinite(fromAmountSen) || fromAmountSen <= 0) {
    return NextResponse.json({ error: 'A positive source amount is required' }, { status: 400 });
  }

  const quote = await calculateQuote(fromAmountSen, recipientId, targetCurrency, feeTier);

  return NextResponse.json(quote);
}
