import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveFundingSelection } from '@/lib/funding/registry';
import { ingestStablecoinDeposit } from '@/lib/server/funding-intake';
import { readFundingSession } from '@/lib/server/funding-sessions';

const actionSchema = z.object({ action: z.literal('SIMULATE_DEPOSIT') });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = readFundingSession(id);
  return session
    ? NextResponse.json({ session })
    : NextResponse.json({ error: 'Funding session not found' }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.USE_MOCK_APIS !== 'true' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'Deposit simulation is disabled' }, { status: 404 });
  }
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid funding action' }, { status: 400 });
  const { id } = await context.params;
  const session = readFundingSession(id);
  if (!session) return NextResponse.json({ error: 'Funding session not found' }, { status: 404 });
  if (session.selection.type !== 'stablecoin') {
    return NextResponse.json({ error: 'Only stablecoin deposits can be simulated' }, { status: 400 });
  }

  try {
    const { asset } = resolveFundingSelection(session.selection);
    if (!asset?.coinType) {
      return NextResponse.json({ error: `${session.selection.asset} coin type is not configured` }, { status: 503 });
    }
    const credited = await ingestStablecoinDeposit({
      sessionId: session.id,
      sourceTxDigest: `DEMO_DEPOSIT_${Date.now().toString(36)}`,
      receivedCoinType: session.selection.rail === 'SUI_NATIVE' ? asset.coinType : `source:${session.selection.sourceChain}:USDC`,
      destinationCoinType: session.selection.rail === 'CCTP' ? asset.coinType : undefined,
      amountMicro: session.amountExpectedMicro,
      sourceType: 'self_custody',
      riskScore: 12,
      sourceOfFundsTraced: true,
      cctpMessageStatus: session.selection.rail === 'CCTP' ? 'minted' : undefined,
    });
    return NextResponse.json({ session: credited });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Deposit could not be processed' },
      { status: 400 },
    );
  }
}
