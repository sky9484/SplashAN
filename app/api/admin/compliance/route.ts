import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminSession } from '@/lib/server/admin-auth';
import { readComplianceControls, updateComplianceControls } from '@/lib/server/sui-settlement';

export const dynamic = 'force-dynamic';

const schema = z.object({
  maxDeviationPpm: z.number().int().min(1).max(10_000),
  maxStalenessMs: z.number().int().min(1).max(600_000),
  maxSlippageBps: z.number().int().min(1).max(1_000),
  minDepthBaseUnits: z.number().int().min(1),
  paused: z.boolean(),
});

export async function GET() {
  if (!(await getAdminSession())) return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  return NextResponse.json(await readComplianceControls());
}

export async function PUT(request: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid bounded compliance thresholds' }, { status: 400 });
  try {
    const result = await updateComplianceControls(parsed.data);
    return NextResponse.json({ ...(await readComplianceControls()), digest: result.digest });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Compliance update failed' }, { status: 500 });
  }
}
