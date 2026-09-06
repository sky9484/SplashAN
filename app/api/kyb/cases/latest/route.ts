import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { findLatestKybCaseForOrg, type KybCaseRecord } from '@/lib/server/kyb';
import { resolveSessionAccount } from '@/lib/server/session-account';

export const dynamic = 'force-dynamic';

function toPublicCase(record: KybCaseRecord) {
  return {
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
  };
}

/**
 * GET /api/kyb/cases/latest — the caller's own latest KYB case.
 *
 * Takes NO parameters. It used to read `businessName` and `registrationNumber`
 * from the query string and match them against every case in the process, so
 * any signed-in customer could pass a competitor's name and receive their KYB
 * file: registration number, reviewer notes, decision reason, and the name and
 * SHA-256 of every uploaded document. A business name is not a secret.
 *
 * `requireCustomerRequest` proves WHO is asking and says nothing about whose
 * data may be returned. The org therefore comes from the membership, resolved
 * server-side, and never from the request.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { orgId } = await resolveSessionAccount(auth.session);
  const record = findLatestKybCaseForOrg(orgId);

  if (!record) {
    return NextResponse.json({ case: null });
  }

  return NextResponse.json({ case: toPublicCase(record) });
}
