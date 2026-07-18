import type { ProposalStatus, SimulationResult, UnsignedProposal, UserRole } from '@/lib/agent/types';
import { recordProposalTransition } from '../observability/proposals.ts';

export class ProposalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalStateError';
  }
}

export type ProposalApproval = UnsignedProposal['approvals'][number];

export type ProposalTransitionEvent =
  | { type: 'SIMULATION_COMPLETED'; simulation: SimulationResult }
  | { type: 'POLICY_EVALUATED'; requiredApprovers: 0 | 1 | 2 }
  | { type: 'QUEUE_FOR_APPROVAL' }
  | { type: 'MARK_APPROVED' }
  | { type: 'APPROVE'; approval: ProposalApproval }
  | { type: 'SIGN'; signatureRef: string; signedBy: string; policyAuthorized: boolean; signedAt: string }
  | { type: 'SUBMIT' }
  | { type: 'SETTLE'; settlement: NonNullable<UnsignedProposal['settlement']> }
  | { type: 'ANCHOR' }
  | { type: 'REJECT'; reason?: string }
  | { type: 'FAIL'; reason: string }
  | { type: 'EXPIRE' }
  | { type: 'REVERSE'; reason: string };

const terminalStatuses = new Set<ProposalStatus>(['ANCHORED', 'REJECTED', 'FAILED', 'EXPIRED', 'REVERSED']);
const approverRoles = new Set<UserRole>(['OWNER', 'FINANCE_ADMIN', 'APPROVER']);

function assertTransition(current: ProposalStatus, allowed: ProposalStatus[], eventType: ProposalTransitionEvent['type']) {
  if (!allowed.includes(current)) {
    throw new ProposalStateError(`${eventType} is not allowed from ${current}`);
  }
}

function assertNotTerminal(status: ProposalStatus, eventType: ProposalTransitionEvent['type']) {
  if (terminalStatuses.has(status)) {
    throw new ProposalStateError(`${eventType} is not allowed after ${status}`);
  }
}

function requiredApprovers(proposal: UnsignedProposal): 0 | 1 | 2 {
  if (proposal.explain.requiredApprovers === 0) return 0;
  if (proposal.explain.requiredApprovers === 1) return 1;
  if (proposal.explain.requiredApprovers === 2) return 2;
  throw new ProposalStateError('requiredApprovers must be 0, 1, or 2');
}

function hasMetApprovalRequirement(proposal: UnsignedProposal) {
  return new Set(proposal.approvals.map((approval) => approval.userId)).size >= requiredApprovers(proposal);
}

function assertApprovalAllowed(proposal: UnsignedProposal, approval: ProposalApproval) {
  if (!approverRoles.has(approval.role)) {
    throw new ProposalStateError(`${approval.role} cannot approve proposals`);
  }
  if (proposal.createdBy !== 'OXWAL' && approval.userId === proposal.createdBy) {
    throw new ProposalStateError('maker cannot approve their own proposal');
  }
  if (proposal.approvals.some((item) => item.userId === approval.userId)) {
    throw new ProposalStateError('approval must come from a distinct approver');
  }
}

function markApprovedIfReady(proposal: UnsignedProposal): UnsignedProposal {
  return hasMetApprovalRequirement(proposal)
    ? { ...proposal, status: 'APPROVED' }
    : proposal;
}

function rejectIfUnsignedOutboundSubmission(proposal: UnsignedProposal, event: ProposalTransitionEvent) {
  if (event.type !== 'SUBMIT') return;
  if (proposal.status !== 'SIGNED') {
    throw new ProposalStateError('proposal must be signed before submission');
  }
}

function actorForEvent(event: ProposalTransitionEvent) {
  if (event.type === 'APPROVE') return event.approval.userId;
  if (event.type === 'SIGN') return event.signedBy;
  return 'system';
}

function applyProposalTransition(
  proposal: UnsignedProposal,
  event: ProposalTransitionEvent,
): UnsignedProposal {
  rejectIfUnsignedOutboundSubmission(proposal, event);

  switch (event.type) {
    case 'SIMULATION_COMPLETED':
      assertTransition(proposal.status, ['DRAFTED'], event.type);
      return {
        ...proposal,
        status: event.simulation.ok ? 'SIMULATED' : 'FAILED',
        simulation: event.simulation,
      };
    case 'POLICY_EVALUATED':
      assertTransition(proposal.status, ['SIMULATED'], event.type);
      return {
        ...proposal,
        status: 'POLICY_EVALUATED',
        explain: { ...proposal.explain, requiredApprovers: event.requiredApprovers },
      };
    case 'QUEUE_FOR_APPROVAL':
      assertTransition(proposal.status, ['POLICY_EVALUATED'], event.type);
      if (requiredApprovers(proposal) === 0) {
        throw new ProposalStateError('proposal with zero required approvers should be marked approved');
      }
      return { ...proposal, status: 'PENDING_APPROVAL' };
    case 'MARK_APPROVED':
      assertTransition(proposal.status, ['POLICY_EVALUATED', 'PENDING_APPROVAL'], event.type);
      if (!hasMetApprovalRequirement(proposal)) {
        throw new ProposalStateError('approval requirement has not been met');
      }
      return { ...proposal, status: 'APPROVED' };
    case 'APPROVE': {
      assertTransition(proposal.status, ['PENDING_APPROVAL'], event.type);
      assertApprovalAllowed(proposal, event.approval);
      return markApprovedIfReady({
        ...proposal,
        approvals: [...proposal.approvals, event.approval],
      });
    }
    case 'SIGN':
      assertTransition(proposal.status, ['APPROVED'], event.type);
      if (!event.policyAuthorized) {
        throw new ProposalStateError('policy authorization is required before signing');
      }
      if (!event.signatureRef || !event.signedBy || event.signedBy === 'OXWAL' || !event.signedAt) {
        throw new ProposalStateError('a human signature reference is required before signing');
      }
      if (!hasMetApprovalRequirement(proposal)) {
        throw new ProposalStateError('approval requirement has not been met');
      }
      return { ...proposal, status: 'SIGNED' };
    case 'SUBMIT':
      assertTransition(proposal.status, ['SIGNED'], event.type);
      return { ...proposal, status: 'SUBMITTED' };
    case 'SETTLE':
      assertTransition(proposal.status, ['SUBMITTED'], event.type);
      return { ...proposal, status: 'SETTLED', settlement: event.settlement };
    case 'ANCHOR':
      assertTransition(proposal.status, ['SETTLED'], event.type);
      return { ...proposal, status: 'ANCHORED' };
    case 'REJECT':
      assertNotTerminal(proposal.status, event.type);
      return { ...proposal, status: 'REJECTED' };
    case 'FAIL':
      assertNotTerminal(proposal.status, event.type);
      return { ...proposal, status: 'FAILED' };
    case 'EXPIRE':
      assertTransition(proposal.status, ['DRAFTED', 'SIMULATED', 'POLICY_EVALUATED', 'PENDING_APPROVAL', 'APPROVED'], event.type);
      return { ...proposal, status: 'EXPIRED' };
    case 'REVERSE':
      assertTransition(proposal.status, ['SETTLED', 'ANCHORED'], event.type);
      return { ...proposal, status: 'REVERSED' };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function transitionProposal(
  proposal: UnsignedProposal,
  event: ProposalTransitionEvent,
): UnsignedProposal {
  const startedAt = Date.now();
  const next = applyProposalTransition(proposal, event);
  if (next.status !== proposal.status) {
    recordProposalTransition({
      proposalId: proposal.id,
      kind: proposal.kind,
      tier: proposal.tier,
      from: proposal.status,
      to: next.status,
      eventType: event.type,
      actor: actorForEvent(event),
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  }
  return next;
}

export class InMemoryProposalStore {
  private readonly proposalsById = new Map<string, UnsignedProposal>();
  private readonly idsByIdempotencyKey = new Map<string, string>();
  /** W1 — durable write-through hook: called after every mutation with the
   *  latest proposal state. Persistence failures must not break the demo
   *  path, so the hook's promise is tracked (flush) but never thrown here. */
  private lastWrite: Promise<unknown> = Promise.resolve();
  private readonly onWrite?: (proposal: UnsignedProposal) => Promise<void>;

  constructor(onWrite?: (proposal: UnsignedProposal) => Promise<void>) {
    this.onWrite = onWrite;
  }

  private recordWrite(proposal: UnsignedProposal) {
    if (!this.onWrite) return;
    this.lastWrite = this.lastWrite
      .then(() => this.onWrite!(proposal))
      .catch((error) => {
        console.error('[proposal-store] persistence write failed', error);
      });
  }

  /** Await durable persistence of every mutation issued so far. Mutating API
   *  routes call this before responding so a crash right after the response
   *  cannot lose an approval. */
  flush(): Promise<unknown> {
    return this.lastWrite;
  }

  /** Boot hydration (W1): seed the hot in-memory map from the database
   *  without re-triggering writes. Existing entries win — live state is
   *  newer than anything loaded later. */
  hydrate(proposals: UnsignedProposal[]) {
    for (const proposal of proposals) {
      if (this.proposalsById.has(proposal.id)) continue;
      this.proposalsById.set(proposal.id, proposal);
      this.idsByIdempotencyKey.set(proposal.idempotencyKey, proposal.id);
    }
  }

  create(proposal: UnsignedProposal): UnsignedProposal {
    const existingId = this.idsByIdempotencyKey.get(proposal.idempotencyKey);
    if (existingId) {
      const existing = this.proposalsById.get(existingId);
      if (!existing) throw new ProposalStateError('idempotency index points to a missing proposal');
      return existing;
    }

    if (this.proposalsById.has(proposal.id)) {
      throw new ProposalStateError(`proposal ${proposal.id} already exists`);
    }

    this.proposalsById.set(proposal.id, proposal);
    this.idsByIdempotencyKey.set(proposal.idempotencyKey, proposal.id);
    this.recordWrite(proposal);
    return proposal;
  }

  get(id: string): UnsignedProposal | null {
    return this.proposalsById.get(id) ?? null;
  }

  list(): UnsignedProposal[] {
    return [...this.proposalsById.values()];
  }

  transition(id: string, event: ProposalTransitionEvent): UnsignedProposal {
    const proposal = this.proposalsById.get(id);
    if (!proposal) throw new ProposalStateError(`proposal ${id} was not found`);

    const next = transitionProposal(proposal, event);
    this.proposalsById.set(id, next);
    this.recordWrite(next);
    return next;
  }
}
