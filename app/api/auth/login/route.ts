import { NextResponse } from 'next/server';
import { z } from 'zod';

import { setCustomerSessionCookie, validateCustomerCredentials } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid email and password are required' }, { status: 400 });
  }

  const session = validateCustomerCredentials(parsed.data.email, parsed.data.password);
  if (!session) {
    return NextResponse.json({ error: 'Invalid business credentials' }, { status: 401 });
  }

  const refreshedSession = await setCustomerSessionCookie(session, { remember: parsed.data.remember });
  return NextResponse.json({ session: refreshedSession });
}
