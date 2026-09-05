import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { buildRecipient, type RecipientRecord, type RecipientTier } from '@/lib/server/operations';
import { listRecipientsFor, persistRecipient } from '@/lib/server/recipients-store';
import { requireSessionAccount } from '@/lib/server/session-account';

export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  // This returned EVERY tenant's beneficiaries — names, banks, SWIFT codes,
  // account numbers — to any authenticated caller. Not one record at a time:
  // the whole list, which is the entire PII payload a travel-rule record
  // exists to protect.
  const accountCheck = await requireSessionAccount(auth.session);
  if (accountCheck.response) return accountCheck.response;

  return NextResponse.json(await listRecipientsFor(accountCheck.account.orgId));
}

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const accountCheck = await requireSessionAccount(auth.session);
  if (accountCheck.response) return accountCheck.response;

  const body = await readJsonBody(request);
  const name = String(body.name ?? '').trim();
  const account = String(body.account ?? '').trim();

  if (!name || !account) {
    return NextResponse.json({ error: 'Name and account number are required' }, { status: 400 });
  }

  const record = await persistRecipient(buildRecipient({
    // From the SESSION, never the request. This is the field that decides whose
    // beneficiary it is and therefore who can read it back.
    orgId: accountCheck.account.orgId,
    name,
    country: String(body.country ?? 'PH'),
    bank: String(body.bank ?? ''),
    swift: String(body.swift ?? ''),
    account,
    tier: body.tier as RecipientTier | undefined,
    kybStatus: body.kybStatus as RecipientRecord['kybStatus'] | undefined,
    orgEmail: typeof body.orgEmail === 'string' ? body.orgEmail : undefined,
    createdVia: body.createdVia as RecipientRecord['createdVia'] | undefined,
    sweepConfig: body.sweepConfig as RecipientRecord['sweepConfig'] | undefined,
  }));

  return NextResponse.json(record, { status: 201 });
}
