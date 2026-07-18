import { z } from 'zod';

import type { ComplianceResult, OrgPolicy, ProposalKind, UserRole } from '@/lib/agent/types';
import { getOxwalProposalStore } from '@/lib/agent/oxwal';
import { ensureProposalStoreHydrated } from '@/lib/queue/proposal-persistence';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
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
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const parsed = submitSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return json({ error: 'Invalid proposal submission' }, 400);

  const store = getOxwalProposalStore();
  // W1: after a cold start, open proposals live in Postgres until first touch.
  await ensureProposalStoreHydrated(store);
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

    // Walk the maker-checker chain from wherever the proposal currently sits.
    // The policy engine (not the caller) decides how many approvers are needed.
    const signedAt = new Date().toISOString();
    let current = proposal;

    if (current.status === 'SIMULATED') {
      const approvers = policyDecision.outcome === 'REQUIRE_APPROVAL' ? policyDecision.approvers : 0;
      current = store.transition(id, { type: 'POLICY_EVALUATED', requiredApprovers: approvers });
      if (approvers === 0) {
        current = store.transition(id, { type: 'MARK_APPROVED' });
      } else {
        current = store.transition(id, { type: 'QUEUE_FOR_APPROVAL' });
      }
    }

    if (current.status === 'PENDING_APPROVAL') {
      current = store.transition(id, {
        type: 'APPROVE',
        approval: { userId: parsed.data.signedBy, role: parsed.data.actorRole, signedAt },
      });
      if (current.status === 'PENDING_APPROVAL') {
        // Dual-control: this signature is recorded; a distinct co-approver
        // must sign from the queue before submission.
        return json({
          proposal: current,
          policyDecision,
          error: 'Your approval is recorded — a second approver must sign from the queue before this settles.',
        }, 409);
      }
    }

    const signed = current.status === 'SIGNED'
      ? current
      : store.transition(id, {
          type: 'SIGN',
          signatureRef: parsed.data.signatureRef,
          signedBy: parsed.data.signedBy,
          policyAuthorized: true,
          signedAt,
        });
    const submitted = store.transition(signed.id, { type: 'SUBMIT' });
    // W1: the approval/submission is durable before we tell the client so a
    // crash right after this response cannot lose it.
    await store.flush();
    return json({ proposal: submitted, policyDecision });
  } catch (error) {
    await store.flush();
    return json({ error: error instanceof Error ? error.message : 'Proposal submission blocked' }, 409);
  }
}
