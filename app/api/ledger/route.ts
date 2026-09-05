import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { getLedgerBalance, listLedgerEntries } from '@/lib/server/operations';
import { isForeignAccountId, requireSessionAccount } from '@/lib/server/session-account';

export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  // Previously `accountId` came from the query string and an omitted value made
  // `listLedgerEntries(undefined)` return EVERY account's entries — the exact
  // enumeration primitive that turns a guessed account id into a targeted
  // debit. The account is now derived from the session and a query-supplied id
  // may only name the caller's own account.
  const accountCheck = await requireSessionAccount(auth.session);
  if (accountCheck.response) return accountCheck.response;
  const { accountId } = accountCheck.account;
  const requested = new URL(request.url).searchParams.get('accountId');
  if (isForeignAccountId(requested, accountId)) {
    return NextResponse.json({ error: 'accountId does not belong to this organization' }, { status: 403 });
  }

  const entries = listLedgerEntries(accountId);
  const balanceMicro = getLedgerBalance(accountId);
  return NextResponse.json({
    accountId,
    entries,
    balanceMicro,
    balanceUsdc: (balanceMicro / 1_000_000).toFixed(2),
  });
}
