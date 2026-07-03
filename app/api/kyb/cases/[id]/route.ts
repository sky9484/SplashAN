import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readKybCase } from '@/lib/server/kyb';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const record = readKybCase(id);

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
