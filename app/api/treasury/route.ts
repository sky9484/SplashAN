/**
 * Smart Treasury ledger API — the two-bucket balances + moves, backed by the
 * off-chain ledger in lib/server/treasury.ts (omnibus + per-user accounting).
 *
 *   GET  → { available, treasuryPrincipal, treasuryYield, rate, notices }
 *   POST { action: 'move' | 'withdraw', amountUsd }
 *          move     → Available (USDC) → Smart Treasury (USDY), instant
 *          withdraw → Smart Treasury → Available, T+1–T+3 notice
 *
 * Amounts are USD (2dp) at the API boundary; the ledger stores micro-USD.
 */

import { NextResponse } from 'next/server';

import {
  getLedger,
  listNotices,
  moveToTreasury,
  requestTreasuryWithdrawal,
} from '@/lib/server/treasury';
import { getTreasuryRate } from '@/lib/server/usdy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toUsd = (micro: number) => Math.round(micro / 10_000) / 100;

function snapshot() {
  const ledger = getLedger();
  const rate = getTreasuryRate();
  return {
    available: toUsd(ledger.availableMicro),
    treasuryPrincipal: toUsd(ledger.treasuryPrincipalMicro),
    treasuryYield: toUsd(ledger.treasuryYieldMicro),
    executionEnabled: process.env.TREASURY_EXECUTION_ENABLED === 'true',
    rate: { apy: rate.netApyPct, label: rate.label, introductory: rate.introductory },
    notices: listNotices(ledger.userId).map((n) => ({
      id: n.id,
      amount: toUsd(n.amountMicro),
      availableAt: n.availableAt,
      state: n.state,
    })),
  };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(request: Request) {
  if (process.env.TREASURY_EXECUTION_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Projection only - execution disabled pending regulatory approval.' },
      { status: 403 },
    );
  }
  let body: { action?: string; amountUsd?: number };
  try {
    body = (await request.json()) as { action?: string; amountUsd?: number };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const amountUsd = Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ error: 'amountUsd must be a positive number' }, { status: 400 });
  }
  const amountMicro = Math.round(amountUsd * 1_000_000);
  const ledger = getLedger();

  try {
    if (body.action === 'move') {
      await moveToTreasury(ledger.userId, amountMicro);
    } else if (body.action === 'withdraw') {
      requestTreasuryWithdrawal(ledger.userId, amountMicro);
    } else {
      return NextResponse.json({ error: "action must be 'move' or 'withdraw'" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  return NextResponse.json(snapshot());
}
