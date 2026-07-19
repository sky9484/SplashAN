export type AutonomyTier = 'TIER_0_PROPOSE' | 'TIER_1_THRESHOLD' | 'TIER_2_SCOPED_AUTO';

export type ProposalKind =
  | 'PAYMENT'
  | 'INTERNAL_TRANSFER'
  | 'FX_CONVERT'
  | 'TREASURY_ALLOCATE'
  | 'TREASURY_REDEEM'
  | 'BATCH_PAYOUT'
  | 'NETTING_SETTLE';

export type ProposalStatus =
  | 'DRAFTED'
  | 'SIMULATED'
  | 'POLICY_EVALUATED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'SETTLED'
  | 'ANCHORED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REVERSED';

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH';

/** Track A WS2 — runtime data provenance label carried by every evidence item. */
export type DataStatus = 'LIVE' | 'STALE' | 'MODELED' | 'DEMO';

/** ALL_LIVE only when every evidence item is status LIVE. */
export type EvidenceQuality = 'ALL_LIVE' | 'CONTAINS_DEMO_DATA';

export interface EvidenceItem {
  /** Provenance status of the underlying datum (absent = legacy/unlabeled). */
  status?: DataStatus;
  source:
    | 'BALANCE'
    | 'PYTH_RATE'
    | 'COUNTERPARTY'
    | 'INVOICE'
    | 'TREASURY'
    | 'NETTING'
    | 'COMPLIANCE'
    | 'CORRIDOR_LIQUIDITY';
  ref: string;
  observedAt: string;
  trusted: boolean;
}

export interface FinancialImpact {
  amountIn?: bigint;
  amountOut?: bigint;
  currencyIn?: string;
  currencyOut?: string;
  feeBps?: number;
  fxRate?: { value: string; pythPriceId: string; observedAt: string };
  yieldDeltaBps?: number;
  nettingSaved?: bigint;
}

export interface ProposalExplain {
  recommendation: string;
  financialImpact: FinancialImpact;
  evidence: EvidenceItem[];
  confidence: number;
  risk: RiskBand;
  requiredApprovers: number;
  reasoningTraceRef: string;
  /** Track A WS2 — set at proposal creation from the evidence statuses. */
  evidenceQuality?: EvidenceQuality;
}

export interface SimulationResult {
  ok: boolean;
  balanceChanges: { owner: string; coinType: string; amount: string }[];
  gasSponsored: boolean;
  error?: string;
  simulatedAt: string;
}

export type UserRole =
  | 'OWNER'
  | 'FINANCE_ADMIN'
  | 'MAKER'
  | 'APPROVER'
  | 'VIEWER'
  | 'AUDITOR'
  | 'DEVELOPER';

export interface UnsignedProposal {
  id: string;
  idempotencyKey: string;
  kind: ProposalKind;
  status: ProposalStatus;
  tier: AutonomyTier;
  orgId: string;
  corridor?: string;
  unsignedTxBytes: string;
  simulation?: SimulationResult;
  explain: ProposalExplain;
  createdBy: 'OXWAL' | string;
  createdAt: string;
  expiresAt: string;
  /** Track A §1.4 — canon version; bumped on any canon-field mutation, which
   *  voids all prior approvals. Absent on legacy rows = 1. */
  version?: number;
  /** Server-computed canonical approval hash (lib/proposals/canonical-hash). */
  approvalHash?: string;
  approvals: { userId: string; role: UserRole; signedAt: string }[];
  settlement?: { digest: string; walrusBlobId: string; auditEventId: string };
}

export interface OrgPolicy {
  orgId: string;
  tier1ThresholdUsd: bigint;
  dualApprovalThresholdUsd: bigint;
  whitelistedAutoKinds: ProposalKind[];
  operatingMinimumByCorridor: Record<string, bigint>;
  perCorridorState: Record<string, 'ARMED' | 'PAUSED'>;
  globalState: 'ARMED' | 'PAUSED';
}

export interface ComplianceResult {
  kytPassed: boolean;
  kybStatus: 'VERIFIED' | 'PENDING' | 'FAILED';
  sanctionsClear: boolean;
  flags: string[];
}
