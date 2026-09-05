import { createHash } from 'node:crypto';

import type { PolicyDecision } from '../policy/evaluate.ts';
import type { SimulationResult, UnsignedProposal, UserRole } from '../agent/types.ts';
import type { AuditReceipt } from '../server/operations.ts';
import { readSealPolicy, sealAdapter, type SealPolicy } from '../server/seal.ts';
import { retrieveBlob, storeEncryptedInvoice, type WalrusBlob } from '../server/walrus.ts';

export type EvidenceConversationItem = {
  role: 'USER' | 'ASSISTANT' | 'TOOL' | 'SYSTEM';
  excerpt: string;
  observedAt: string;
  trusted: boolean;
};

export interface SettlementEvidenceBundle {
  schema: 'splash.settlement-evidence.v1';
  transferId: string;
  proposal: Pick<UnsignedProposal, 'id' | 'idempotencyKey' | 'kind' | 'tier' | 'createdBy' | 'createdAt'> | null;
  conversation: EvidenceConversationItem[];
  reasoningTraceRef: string;
  simulation: SimulationResult | null;
  policyDecision: PolicyDecision | null;
  approvals: Array<{ userId: string; role: UserRole; signedAt: string }>;
  funding?: AuditReceipt['funding'];
  settlement: {
    paymentIntentId: string;
    intentCreateDigest: string;
    expectedAnchorId: string;
    recipient: string;
    targetCurrency: string;
    paymentMist: number;
  };
  createdAt: string;
}

export interface StoredSettlementEvidence {
  schema: SettlementEvidenceBundle['schema'];
  plaintextHash: string;
  ciphertextHash: string;
  walrusBlobId: string;
  walrusMode: WalrusBlob['mode'];
  walrusSizeBytes: number;
  sealPolicyId: string;
  sealMode: SealPolicy['mode'];
  createdAt: string;
}

export interface SettlementEvidenceProof {
  walrusBlobFound: boolean;
  walrusMode: WalrusBlob['mode'] | null;
  sealPolicyFound: boolean;
  sealMode: SealPolicy['mode'] | null;
  ciphertextHash: string | null;
  expectedCiphertextHash: string | null;
  walrusHashVerified: boolean;
  anchorRecorded: boolean;
  auditEventId: string | null;
  suiDigest: string | null;
  verified: boolean;
  checkedAt: string;
  error?: string;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function evidenceStringify(value: unknown) {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

export function createTransferSettlementEvidence(input: {
  transferId: string;
  recipient: string;
  targetCurrency: string;
  paymentMist: number;
  paymentIntentId: string;
  intentCreateDigest: string;
  expectedAnchorId: string;
  funding?: AuditReceipt['funding'];
  approvals?: SettlementEvidenceBundle['approvals'];
  conversation?: EvidenceConversationItem[];
  reasoningTraceRef?: string;
  simulation?: SimulationResult | null;
  policyDecision?: PolicyDecision | null;
  createdAt?: string;
}): SettlementEvidenceBundle {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    schema: 'splash.settlement-evidence.v1',
    transferId: input.transferId,
    proposal: null,
    conversation: input.conversation ?? [],
    reasoningTraceRef: input.reasoningTraceRef ?? `dashboard-authorization:${input.transferId}`,
    simulation: input.simulation ?? null,
    policyDecision: input.policyDecision ?? { outcome: 'REQUIRE_APPROVAL', approvers: 1 },
    approvals: input.approvals ?? [{ userId: 'dashboard-operator', role: 'FINANCE_ADMIN', signedAt: createdAt }],
    funding: input.funding,
    settlement: {
      paymentIntentId: input.paymentIntentId,
      intentCreateDigest: input.intentCreateDigest,
      expectedAnchorId: input.expectedAnchorId,
      recipient: input.recipient,
      targetCurrency: input.targetCurrency,
      paymentMist: input.paymentMist,
    },
    createdAt,
  };
}

export async function sealAndStoreSettlementEvidence(
  bundle: SettlementEvidenceBundle,
  allowlist: string[],
): Promise<{
  bundle: SettlementEvidenceBundle;
  walrus: WalrusBlob;
  policy: SealPolicy;
  record: StoredSettlementEvidence;
}> {
  const plaintext = evidenceStringify(bundle);
  const { ciphertext, policy } = await sealAdapter.encrypt(plaintext, allowlist);
  const walrus = await storeEncryptedInvoice(ciphertext);
  const record: StoredSettlementEvidence = {
    schema: bundle.schema,
    plaintextHash: sha256(plaintext),
    ciphertextHash: sha256(ciphertext),
    walrusBlobId: walrus.blobId,
    walrusMode: walrus.mode,
    walrusSizeBytes: walrus.sizeBytes,
    sealPolicyId: policy.policyId,
    sealMode: policy.mode,
    createdAt: new Date().toISOString(),
  };
  return { bundle, walrus, policy, record };
}

export async function verifyStoredSettlementEvidence(input: {
  walrusBlobId?: string | null;
  sealPolicyId?: string | null;
  expectedCiphertextHash?: string | null;
  auditEventId?: string | null;
  suiDigest?: string | null;
}): Promise<SettlementEvidenceProof> {
  const checkedAt = new Date().toISOString();
  const expectedCiphertextHash = input.expectedCiphertextHash ?? null;
  const base = {
    expectedCiphertextHash,
    auditEventId: input.auditEventId ?? null,
    suiDigest: input.suiDigest ?? null,
    anchorRecorded: Boolean(input.auditEventId && input.suiDigest),
    checkedAt,
  };

  if (!input.walrusBlobId || !input.sealPolicyId || !expectedCiphertextHash) {
    return {
      ...base,
      walrusBlobFound: false,
      walrusMode: null,
      sealPolicyFound: Boolean(input.sealPolicyId && readSealPolicy(input.sealPolicyId)),
      sealMode: input.sealPolicyId ? readSealPolicy(input.sealPolicyId)?.mode ?? null : null,
      ciphertextHash: null,
      walrusHashVerified: false,
      verified: false,
      error: 'Incomplete settlement proof chain',
    };
  }

  try {
    const [blob, policy] = await Promise.all([
      retrieveBlob(input.walrusBlobId),
      Promise.resolve(readSealPolicy(input.sealPolicyId)),
    ]);
    const ciphertextHash = blob ? sha256(blob.encryptedData) : null;
    const walrusHashVerified = Boolean(ciphertextHash && ciphertextHash === expectedCiphertextHash);
    return {
      ...base,
      walrusBlobFound: Boolean(blob),
      walrusMode: blob?.mode ?? null,
      sealPolicyFound: Boolean(policy),
      sealMode: policy?.mode ?? null,
      ciphertextHash,
      walrusHashVerified,
      verified: Boolean(blob && policy && walrusHashVerified && base.anchorRecorded),
    };
  } catch (error) {
    return {
      ...base,
      walrusBlobFound: false,
      walrusMode: null,
      sealPolicyFound: false,
      sealMode: null,
      ciphertextHash: null,
      walrusHashVerified: false,
      verified: false,
      error: error instanceof Error ? error.message : 'Settlement proof verification failed',
    };
  }
}
