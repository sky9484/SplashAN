import { createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { recordKybSubmission, type KybDocumentRecord } from '@/lib/server/kyb';
import { resolveSessionAccount } from '@/lib/server/session-account';

export const dynamic = 'force-dynamic';

const ALLOWED_DOC_KINDS = new Set<KybDocumentRecord['kind']>(['COMPANY_DOCUMENT', 'DIRECTOR_ID']);

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  // The owning org is resolved from the membership, not taken from the form.
  // `recordKybSubmission` used to default a missing orgId to 'demo-business'
  // and this route passed none, so every business's KYB case and documents
  // were filed into the shared demo workspace.
  const { orgId } = await resolveSessionAccount(auth.session);

  const formData = await request.formData();
  const files = formData.getAll('documents').filter((item): item is File => item instanceof File);
  const legalName = String(formData.get('businessName') ?? '');
  const registrationNumber = String(formData.get('ssmNumber') ?? '');
  // Optional explicit per-file classification (same order as `documents`).
  // Preferred over the filename heuristic so a reviewer's "director ID present"
  // signal can't be gamed by simply naming a file "director.pdf".
  const declaredKinds = formData.getAll('documentKinds').map((value) => String(value));

  if (files.length === 0) {
    return NextResponse.json({ error: 'No KYB documents provided' }, { status: 400 });
  }

  if (!legalName || !registrationNumber) {
    return NextResponse.json({ error: 'Business name and registration number are required' }, { status: 400 });
  }

  // Unguessable case id: do NOT derive it from public business attributes
  // (legal name / SSM number), which would let anyone recompute it.
  const kybCaseId = `kyb_${Date.now().toString(36)}_${randomBytes(12).toString('hex')}`;
  const documents: KybDocumentRecord[] = await Promise.all(
    files.map(async (file, index) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      const hash = createHash('sha256').update(bytes).digest('hex');

      const declared = declaredKinds[index] as KybDocumentRecord['kind'] | undefined;
      const kind: KybDocumentRecord['kind'] = declared && ALLOWED_DOC_KINDS.has(declared)
        ? declared
        : file.name.toLowerCase().includes('director')
          ? 'DIRECTOR_ID'
          : 'COMPANY_DOCUMENT';

      return {
        name: file.name,
        kind,
        type: file.type || 'application/octet-stream',
        size: file.size,
        sha256: hash,
        storageKey: `kyb/${kybCaseId}/${hash}-${file.name}`,
        virusScanResult: 'PENDING',
        uploadedAt: new Date().toISOString(),
      };
    }),
  );
  const kybCase = recordKybSubmission({ caseId: kybCaseId, orgId, businessName: legalName, registrationNumber, documents });

  return NextResponse.json({
    kybCaseId,
    state: kybCase.state,
    documents,
  });
}
