import { NextResponse } from 'next/server';
import { z } from 'zod';

import { setCustomerSessionCookie, validateCustomerCredentials } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

const loginSchema = z.object({
  /** The workspace login is an identifier, not necessarily an RFC-5322 address:
   *  demo/business logins like "splash@demo" have no TLD and are rejected by
   *  z.email(). Validate presence and length only — the credential check in
   *  validateCustomerCredentials is an exact, timing-safe comparison against
   *  CUSTOMER_EMAIL, so accepting a username shape here weakens nothing.
   *  Signup and recovery keep strict email validation: those actually send mail. */
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email or username and password are required' }, { status: 400 });
  }

  const session = validateCustomerCredentials(parsed.data.email, parsed.data.password);
  if (!session) {
    return NextResponse.json({ error: 'Invalid business credentials' }, { status: 401 });
  }

  const refreshedSession = await setCustomerSessionCookie(session, { remember: parsed.data.remember });
  return NextResponse.json({ session: refreshedSession });
}
