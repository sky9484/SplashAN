import { z } from 'zod';

import type { ComplianceResult, OrgPolicy, ProposalKind, UserRole } from '@/lib/agent/types';
import { getOxwalProposalStore } from '@/lib/agent/oxwal';
import { authorizeProposalSubmission } from '@/lib/safety/submit-guard';

const userRoles: UserRole[] = ['OWNER', 'FINANCE_ADMIN', 'MAKER', 'APPROVER', 'VIEWER', 'AUDITOR', 'DEVELOPER'];

const submitSchema = z.object({
  signatureRef: z.string().trim().min(1),
  signedBy: z.string().trim().min(1),
  actorRole: z.enum(userRoles).default('APPROVER'),
  policy: z.object({
    tier1ThresholdUsd: z.union([z.string(), z.number()]).optional(),
    dualApprovalThresholdUsd: z.union([z.string(), z.number()]).optional(),
    whitelistedAutoKinds: z.array(z.string()).optional(),
    operatingMinimumByCorridor: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    perCorridorState: z.record(z.string(), z.enum(['ARMED', 'PAUSED'])).optional(),
    globalState: z.enum(['ARMED', 'PAUSED']).optional(),
  }).optional(),
  compliance: z.object({
    kytPassed: z.boolean(),
    kybStatus: z.enum(['VERIFIED', 'PENDING', 'FAILED']),
    sanctionsClear: z.boolean(),
    flags: z.array(z.string()),
  }).optional(),
});

function bigintFrom(value: string | number | undefined, fallback: bigint) {
  if (value === undefined) return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function policyFromBody(orgId: string, bodyPolicy: z.infer<typeof submitSchema>['policy']): OrgPolicy {
  const operatingMinimumByCorridor = Object.fromEntries(
    Object.entries(bodyPolicy?.operatingMinimumByCorridor ?? {}).map(([corridor, amount]) => [corridor, bigintFrom(amount, BigInt(0))]),
  );
  return {
    orgId,
    tier1ThresholdUsd: bigintFrom(bodyPolicy?.tier1ThresholdUsd, BigInt(5_000_000)),
    dualApprovalThresholdUsd: bigintFrom(bodyPolicy?.dualApprovalThresholdUsd, BigInt(50_000_000)),
    whitelistedAutoKinds: (bodyPolicy?.whitelistedAutoKinds ?? ['TREASURY_ALLOCATE'])
      .filter((kind): kind is ProposalKind => [
        'PAYMENT',
        'INTERNAL_TRANSFER',
        'FX_CONVERT',
        'TREASURY_ALLOCATE',
        'TREASURY_REDEEM',
        'BATCH_PAYOUT',
        'NETTING_SETTLE',
      ].includes(kind)),
    operatingMinimumByCorridor,
    perCorridorState: bodyPolicy?.perCorridorState ?? {},
    globalState: bodyPolicy?.globalState ?? 'ARMED',
  };
}

function complianceFromBody(compliance?: ComplianceResult): ComplianceResult {
  return compliance ?? {
    kytPassed: true,
    kybStatus: 'VERIFIED',
    sanctionsClear: true,
    flags: [],
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid proposal submission' }, 400);

  const store = getOxwalProposalStore();
  const proposal = store.get(id);
  if (!proposal) return json({ error: 'Proposal not found' }, 404);
  if (!proposal.simulation) return json({ error: 'Proposal must be simulated before submission' }, 409);

  try {
    const policyDecision = authorizeProposalSubmission({
      proposal,
      actor: parsed.data.actorRole,
      policy: policyFromBody(proposal.orgId, parsed.data.policy),
      simulation: proposal.simulation,
      compliance: complianceFromBody(parsed.data.compliance),
      signatureRef: parsed.data.signatureRef,
      signedBy: parsed.data.signedBy,
    });
    const signed = proposal.status === 'SIGNED'
      ? proposal
      : store.transition(id, {
          type: 'SIGN',
          signatureRef: parsed.data.signatureRef,
          signedBy: parsed.data.signedBy,
          policyAuthorized: true,
          signedAt: new Date().toISOString(),
        });
    const submitted = store.transition(signed.id, { type: 'SUBMIT' });
    return json({ proposal: submitted, policyDecision });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Proposal submission blocked' }, 409);
  }
}
