import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { findLatestKybCase } from '@/lib/server/kyb';

export const dynamic = 'force-dynamic';

function toPublicCase(record: NonNullable<ReturnType<typeof findLatestKybCase>>) {
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

export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const businessName = searchParams.get('businessName') ?? undefined;
  const registrationNumber = searchParams.get('registrationNumber') ?? undefined;

  const record = findLatestKybCase({ businessName, registrationNumber });

  if (!record) {
    return NextResponse.json({ case: null });
  }

  return NextResponse.json({ case: toPublicCase(record) });
}
