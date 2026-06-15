import { NextResponse } from 'next/server';

import { createRecipient, listRecipients } from '@/lib/server/operations';

export async function GET() {
  return NextResponse.json(listRecipients());
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body.name ?? '').trim();
  const account = String(body.account ?? '').trim();

  if (!name || !account) {
    return NextResponse.json({ error: 'Name and account number are required' }, { status: 400 });
  }

  const record = createRecipient({
    name,
    country: String(body.country ?? 'PH'),
    bank: String(body.bank ?? ''),
    swift: String(body.swift ?? ''),
    account,
    tier: body.tier,
    kybStatus: body.kybStatus,
    orgEmail: body.orgEmail,
    createdVia: body.createdVia,
    sweepConfig: body.sweepConfig,
  });

  return NextResponse.json(record, { status: 201 });
}
