export type KybReviewState = 'SUBMITTED' | 'IN_REVIEW' | 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED';

export type KybDocumentRecord = {
  name: string;
  kind: 'COMPANY_DOCUMENT' | 'DIRECTOR_ID';
  type: string;
  size: number;
  sha256: string;
  storageKey: string;
  virusScanResult: 'PENDING' | 'PASSED' | 'FAILED';
  uploadedAt: string;
};

export type KybAuditEvent = {
  id: string;
  actor: string;
  action: string;
  note: string | null;
  createdAt: string;
};

export type KybCaseRecord = {
  id: string;
  /** Owning organization. Wallet spec §3 — the KYB lifecycle is assessed at org
   *  level, and the on-chain verify must target THAT org's BusinessAccount. */
  orgId: string;
  businessName: string;
  registrationNumber: string;
  state: KybReviewState;
  riskTier: 'UNASSIGNED' | 'TIER_1' | 'TIER_2' | 'RESTRICTED';
  corridorAccess: 'LOCKED' | 'LIMITED' | 'FULL';
  submittedAt: string;
  updatedAt: string;
  assignedTo: string | null;
  sumsubApplicantId: string | null;
  documents: KybDocumentRecord[];
  reviewNotes: string | null;
  decisionReason: string | null;
  auditTrail: KybAuditEvent[];
};

type KybStore = {
  cases: Map<string, KybCaseRecord>;
};

const globalStore = globalThis as typeof globalThis & { splashKybStore?: KybStore };

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function event(actor: string, action: string, note?: string | null): KybAuditEvent {
  return {
    id: id('audit'),
    actor,
    action,
    note: note ?? null,
    createdAt: new Date().toISOString(),
  };
}

function sampleDocument(caseId: string, name: string, kind: KybDocumentRecord['kind']): KybDocumentRecord {
  return {
    name,
    kind,
    type: 'application/pdf',
    size: kind === 'DIRECTOR_ID' ? 384221 : 791205,
    sha256: `${caseId}_${kind}`.padEnd(64, '0').slice(0, 64),
    storageKey: `encrypted/kyb/${caseId}/${name}`,
    virusScanResult: 'PASSED',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  };
}

function seededCases() {
  const firstSubmittedAt = new Date(Date.now() - 1000 * 60 * 92).toISOString();
  const secondSubmittedAt = new Date(Date.now() - 1000 * 60 * 240).toISOString();
  const firstCaseId = 'kyb_demo_acme_sdn_bhd';
  const secondCaseId = 'kyb_demo_nusantara_exports';

  return new Map<string, KybCaseRecord>([
    [
      firstCaseId,
      {
        id: firstCaseId,
        orgId: 'demo-business',
        businessName: 'Acme Trading Sdn Bhd',
        registrationNumber: '202401012345',
        state: 'SUBMITTED',
        riskTier: 'UNASSIGNED',
        corridorAccess: 'LOCKED',
        submittedAt: firstSubmittedAt,
        updatedAt: firstSubmittedAt,
        assignedTo: null,
        sumsubApplicantId: 'sumsub_acme_01',
        documents: [sampleDocument(firstCaseId, 'form-9-acme.pdf', 'COMPANY_DOCUMENT'), sampleDocument(firstCaseId, 'director-id-acme.pdf', 'DIRECTOR_ID')],
        reviewNotes: null,
        decisionReason: null,
        auditTrail: [event('system', 'kyb.submitted', 'Documents uploaded and Sumsub applicant created')],
      },
    ],
    [
      secondCaseId,
      {
        id: secondCaseId,
        orgId: 'demo-business',
        businessName: 'Nusantara Export House Sdn Bhd',
        registrationNumber: '202301998877',
        state: 'NEEDS_INFORMATION',
        riskTier: 'UNASSIGNED',
        corridorAccess: 'LOCKED',
        submittedAt: secondSubmittedAt,
        updatedAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
        assignedTo: 'compliance@splash.finance',
        sumsubApplicantId: 'sumsub_nusantara_02',
        documents: [sampleDocument(secondCaseId, 'company-profile.pdf', 'COMPANY_DOCUMENT'), sampleDocument(secondCaseId, 'director-passport.pdf', 'DIRECTOR_ID')],
        reviewNotes: 'Request latest SSM profile and UBO ownership chart before approval.',
        decisionReason: 'Missing UBO evidence',
        auditTrail: [
          event('system', 'kyb.submitted', 'Documents uploaded and Sumsub applicant created'),
          event('compliance@splash.finance', 'kyb.needs_information', 'Missing UBO evidence'),
        ],
      },
    ],
  ]);
}

export const kybStore = globalStore.splashKybStore ?? {
  cases: seededCases(),
};

globalStore.splashKybStore = kybStore;

export function listKybCases() {
  return Array.from(kybStore.cases.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Staff read. Every case in the process, unscoped — which is correct for the
 * admin console and wrong for anything a customer can reach.
 *
 * The `ForStaff` suffix exists so a customer-facing caller cannot pick this by
 * accident: the reviewer surfaces are the only legitimate callers.
 */
export function listKybCasesForStaff() {
  return listKybCases();
}

/**
 * The customer read: the caller's own latest case, and nothing else.
 *
 * This replaces a lookup that took `businessName` / `registrationNumber` from
 * the QUERY STRING and matched them against every case in the process. A
 * business name is not a secret — it is on the invoice, the website and the
 * registry — so that made one signed-in customer able to fetch a competitor's
 * registration number, reviewer notes, decision reason, and the name and
 * SHA-256 of every document they uploaded.
 *
 * There is no caller-supplied selector any more. The session says who is
 * asking; the org comes from the membership, server-side.
 */
export function findLatestKybCaseForOrg(orgId: string) {
  const owner = orgId.trim();
  if (!owner) return null;
  return listKybCases().find((record) => record.orgId === owner) ?? null;
}

/**
 * The customer read by id, scoped to the owning org.
 *
 * Returns null — not the record — for another org's case, so the route answers
 * 404 rather than 403 and the endpoint is not an id oracle: "exists but not
 * yours" and "does not exist" are indistinguishable to a prober.
 */
export function readKybCaseForOrg(caseId: string, orgId: string) {
  const record = kybStore.cases.get(caseId) ?? null;
  if (!record) return null;
  return record.orgId === orgId.trim() ? record : null;
}

/** Staff read by id. Unscoped by design; reviewers work across orgs. */
export function readKybCase(caseId: string) {
  return kybStore.cases.get(caseId) ?? null;
}

export function recordKybSubmission(input: {
  caseId: string;
  /**
   * Owning org. REQUIRED.
   *
   * This used to be optional and fell back to `'demo-business'`, while the
   * upload route passed nothing — so every real business's KYB case, documents
   * included, was filed into the shared demo workspace and became readable by
   * anyone with access to it.
   */
  orgId: string;
  businessName: string;
  registrationNumber: string;
  documents: KybDocumentRecord[];
  sumsubApplicantId?: string | null;
}) {
  const now = new Date().toISOString();
  const existing = kybStore.cases.get(input.caseId);
  const record: KybCaseRecord = {
    id: input.caseId,
    orgId: input.orgId,
    businessName: input.businessName,
    registrationNumber: input.registrationNumber,
    state: 'SUBMITTED',
    riskTier: 'UNASSIGNED',
    corridorAccess: 'LOCKED',
    submittedAt: existing?.submittedAt ?? now,
    updatedAt: now,
    assignedTo: existing?.assignedTo ?? null,
    sumsubApplicantId: input.sumsubApplicantId ?? existing?.sumsubApplicantId ?? null,
    documents: input.documents,
    reviewNotes: existing?.reviewNotes ?? null,
    decisionReason: existing?.decisionReason ?? null,
    auditTrail: [...(existing?.auditTrail ?? []), event('system', 'kyb.submitted', 'Merchant submitted KYB documents')],
  };

  kybStore.cases.set(record.id, record);

  return record;
}

export function attachSumsubApplicant(caseId: string, applicantId: string | null) {
  const record = kybStore.cases.get(caseId);

  if (!record || !applicantId) {
    return record ?? null;
  }

  record.sumsubApplicantId = applicantId;
  record.updatedAt = new Date().toISOString();
  record.auditTrail = [...record.auditTrail, event('system', 'kyb.sumsub_linked', `Applicant ${applicantId}`)];
  kybStore.cases.set(record.id, record);

  return record;
}

export function reviewKybCase(caseId: string, input: { state: KybReviewState; actor: string; note?: string; assignedTo?: string | null }) {
  const record = kybStore.cases.get(caseId);

  if (!record) {
    return null;
  }

  const now = new Date().toISOString();
  const note = input.note?.trim() || null;
  record.state = input.state;
  record.updatedAt = now;
  record.assignedTo = input.assignedTo === undefined ? record.assignedTo : input.assignedTo;
  record.reviewNotes = note ?? record.reviewNotes;
  record.decisionReason = input.state === 'APPROVED' ? null : note ?? record.decisionReason;
  record.riskTier = input.state === 'APPROVED' ? 'TIER_1' : input.state === 'REJECTED' ? 'RESTRICTED' : record.riskTier;
  record.corridorAccess = input.state === 'APPROVED' ? 'FULL' : input.state === 'REJECTED' ? 'LOCKED' : record.corridorAccess;
  record.auditTrail = [...record.auditTrail, event(input.actor, `kyb.${String(input.state ?? 'unknown').toLowerCase()}`, note)];
  kybStore.cases.set(record.id, record);

  return record;
}
