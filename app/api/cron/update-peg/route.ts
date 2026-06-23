import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

import { pythAdapter } from '@/lib/server/pyth';
import { refreshPegOnSui } from '@/lib/server/sui-settlement';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * This endpoint mutates protocol state (the on-chain peg monitor) and spends
 * sponsored gas, so it must only ever be driven by the scheduler. We require a
 * shared bearer secret (CRON_SECRET) — the same header Vercel Cron sends when
 * CRON_SECRET is configured — and fail closed if it is unset or mismatched.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false; // fail closed: no secret configured → no access

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = Buffer.from(token);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function handlePegUpdate(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { usdc, usdt } = await pythAdapter.getStablecoinPrices();
    const result = await refreshPegOnSui({ usdcPrice: usdc.price, usdtPrice: usdt.price });

    return NextResponse.json({
      success: true,
      usdc_price: usdc.price,
      usdt_price: usdt.price,
      usdc_source: usdc.source,
      usdt_source: usdt.source,
      usdc_deviation_ppm: result.usdcDeviationPpm,
      usdt_deviation_ppm: result.usdtDeviationPpm,
      tx_digest: result.digest,
    });
  } catch (error) {
    // Log full detail server-side only; never reflect internal error strings
    // (object IDs, RPC/sponsor messages) back to the caller.
    console.error('[cron/update-peg] peg update failed:', error);
    return NextResponse.json({ success: false, error: 'peg update failed' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handlePegUpdate(request);
}

export async function POST(request: Request) {
  return handlePegUpdate(request);
}
