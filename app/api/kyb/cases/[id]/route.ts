import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readKybCaseForOrg } from '@/lib/server/kyb';
import { resolveSessionAccount } from '@/lib/server/session-account';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kyb/cases/[id] — one KYB case, only if the caller's org owns it.
 *
 * This used to call the unscoped `readKybCase`, so any signed-in customer who
 * held or guessed an id received that case in full. The id is unguessable by
 * construction, but an unguessable identifier is a secret, not an authorisation
 * check — it leaks by being shared, logged, or pasted into a support ticket.
 *
 * Someone else's case answers 404, not 403, so the endpoint cannot be used as
 * an id oracle: "not yours" and "does not exist" read identically.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const { orgId } = await resolveSessionAccount(auth.session);
  const record = readKybCaseForOrg(id, orgId);

  if (!record) {
    return NextResponse.json({ error: 'KYB case not found' }, { status: 404 });
  }

  return NextResponse.json({
    case: {
      id: record.id,
      businessName: record.businessName,
      registrationNumber: record.registrationNumber,
      state: record.state,
      riskTier: record.riskTier,
      corridorAccess: record.corridorAccess,
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
      sumsubApplicantId: record.sumsubApplicantId,
      reviewNotes: record.reviewNotes,
      decisionReason: record.decisionReason,
      documents: record.documents.map((document) => ({
        name: document.name,
        kind: document.kind,
        type: document.type,
        size: document.size,
        sha256: document.sha256,
        virusScanResult: document.virusScanResult,
        uploadedAt: document.uploadedAt,
      })),
    },
  });
}
