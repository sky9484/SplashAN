import { NextResponse } from 'next/server';
import { z } from 'zod';

import { sealAdapter } from '@/lib/server/seal';

const schema = z.object({ policyId: z.string().min(1), identity: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'policyId and identity are required' }, { status: 400 });
  return NextResponse.json({ granted: await sealAdapter.canDecrypt(parsed.data.policyId, parsed.data.identity) });
}
