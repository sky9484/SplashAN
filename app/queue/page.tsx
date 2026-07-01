import Image from 'next/image';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileWarning,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { ProposalExplain, SimulationResult, UnsignedProposal } from '@/lib/agent/types';
import { buildApprovalQueue, queueLanes, type QueueLane } from '@/lib/queue/approval-queue';

const generatedAt = new Date();

type ProposalOverride = Partial<Omit<UnsignedProposal, 'explain' | 'simulation' | 'approvals'>> & {
  approvals?: UnsignedProposal['approvals'];
  explain?: Partial<ProposalExplain>;
  simulation?: Partial<SimulationResult>;
};

const baseExplain: ProposalExplain = {
  recommendation: 'Release verified supplier payout',
  financialImpact: {
    amountOut: BigInt(420000),
    currencyOut: 'USDC',
    feeBps: 18,
  },
  evidence: [
    { source: 'COUNTERPARTY', ref: 'cp_acme_ph', observedAt: generatedAt.toISOString(), trusted: true },
    { source: 'PYTH_RATE', ref: 'pyth_usdc_usd', observedAt: generatedAt.toISOString(), trusted: true },
  ],
  confidence: 0.91,
  risk: 'LOW',
  requiredApprovers: 1,
  reasoningTraceRef: 'walrus_reasoning_pending',
};

const baseSimulation: SimulationResult = {
  ok: true,
  balanceChanges: [
    { owner: 'org_treasury', coinType: 'USDC', amount: '-420000' },
    { owner: 'cp_acme_ph', coinType: 'USDC', amount: '420000' },
  ],
  gasSponsored: true,
  simulatedAt: generatedAt.toISOString(),
};

function minutesFromNow(minutes: number) {
  return new Date(generatedAt.getTime() + minutes * 60 * 1000).toISOString();
}

function proposal(id: string, overrides: ProposalOverride = {}): UnsignedProposal {
  const explain = { ...baseExplain, ...overrides.explain };
  const simulation = { ...baseSimulation, ...overrides.simulation };
  return {
    id,
    idempotencyKey: `idem_${id}`,
    kind: 'PAYMENT',
    status: 'PENDING_APPROVAL',
    tier: 'TIER_0_PROPOSE',
    orgId: 'org_splash_demo',
    corridor: 'MY_PH',
    unsignedTxBytes: 'dW5zaWduZWQ=',
    createdBy: 'maker_ops_1',
    createdAt: new Date(generatedAt.getTime() - 18 * 60 * 1000).toISOString(),
    expiresAt: minutesFromNow(72),
    approvals: [],
    ...overrides,
    explain,
    simulation,
  };
}

const demoProposals: UnsignedProposal[] = [
  proposal('prop_dual_threshold', {
    explain: {
      recommendation: 'Approve dual-control supplier payout',
      financialImpact: { amountOut: BigInt(1250000), currencyOut: 'USDC', feeBps: 14 },
      requiredApprovers: 2,
      risk: 'MEDIUM',
      confidence: 0.86,
    },
    approvals: [{ userId: 'approver_ops_1', role: 'APPROVER', signedAt: generatedAt.toISOString() }],
  }),
  proposal('prop_expiring_quote', {
    kind: 'FX_CONVERT',
    expiresAt: minutesFromNow(11),
    explain: {
      recommendation: 'Convert corridor float before quote expiry',
      financialImpact: { amountIn: BigInt(300000), amountOut: BigInt(299240), currencyIn: 'USDC', currencyOut: 'USDC', feeBps: 9 },
      requiredApprovers: 1,
      risk: 'LOW',
    },
  }),
  proposal('prop_compliance_hold', {
    explain: {
      recommendation: 'Hold payout pending compliance review',
      evidence: [
        { source: 'COMPLIANCE', ref: 'elliptic_review_case_48', observedAt: generatedAt.toISOString(), trusted: false },
      ],
      requiredApprovers: 1,
      risk: 'HIGH',
      confidence: 0.58,
    },
  }),
  proposal('prop_failed_relay', {
    status: 'FAILED',
    simulation: { ok: false, balanceChanges: [], error: 'settlement relay failed' },
    explain: {
      recommendation: 'Review failed settlement relay',
      risk: 'MEDIUM',
      confidence: 0.7,
    },
  }),
  proposal('prop_anomaly_halt', {
    status: 'FAILED',
    simulation: { ok: false, balanceChanges: [], error: 'anomaly velocity halt' },
    explain: {
      recommendation: 'Investigate outbound velocity halt',
      risk: 'HIGH',
      confidence: 0.49,
    },
  }),
];

const queueView = buildApprovalQueue(demoProposals, { now: generatedAt, expiringWithinMs: 20 * 60 * 1000 });

const laneMeta: Record<QueueLane, { label: string; icon: LucideIcon; tone: string }> = {
  PENDING_APPROVALS: { label: 'Pending approvals', icon: ShieldCheck, tone: 'text-[#326273]' },
  COMPLIANCE_HOLDS: { label: 'Compliance holds', icon: ShieldAlert, tone: 'text-[#E39774]' },
  EXPIRING_QUOTES: { label: 'Expiring quotes', icon: Clock3, tone: 'text-[#E39774]' },
  FAILED_SETTLEMENTS: { label: 'Failed settlements', icon: XCircle, tone: 'text-[#326273]' },
  ANOMALY_HALTS: { label: 'Anomaly halts', icon: AlertTriangle, tone: 'text-[#E39774]' },
};

function formatAmount(proposal: UnsignedProposal) {
  const amount = proposal.explain.financialImpact.amountOut ?? proposal.explain.financialImpact.amountIn ?? BigInt(0);
  const currency = proposal.explain.financialImpact.currencyOut ?? proposal.explain.financialImpact.currencyIn ?? 'USD';
  return `${currency} ${amount.toLocaleString()}`;
}

function formatExpiry(expiresInMs: number | null) {
  if (expiresInMs === null) return 'No expiry';
  if (expiresInMs < 0) return 'Expired';
  const minutes = Math.ceil(expiresInMs / 60000);
  return `${minutes}m`;
}

function riskClass(risk: UnsignedProposal['explain']['risk']) {
  if (risk === 'HIGH') return 'border-[#E39774]/50 bg-[#E39774]/15 text-[#9A4A2D]';
  if (risk === 'MEDIUM') return 'border-[#326273]/20 bg-white/70 text-[#326273]';
  return 'border-[#5C9EAD]/30 bg-[#5C9EAD]/12 text-[#326273]';
}

export default function QueuePage() {
  return (
    <main className="min-h-screen bg-[#F6F0ED] px-4 py-6 text-[#326273] md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-[#326273]/15 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/splash-main-icon.png" alt="Splash" width={40} height={39} className="h-10 w-10 object-contain" />
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5C9EAD]">0xWal control room</p>
              <h1 className="text-3xl font-black tracking-normal text-[#1F4452]">Approval queue</h1>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Link className="rounded-md border border-[#326273]/20 px-3 py-2 text-[#326273]" href="/dashboard">0xWal</Link>
            <Link className="rounded-md bg-[#1F4452] px-3 py-2 text-white" href="/dashboard">Dashboard</Link>
          </nav>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          {queueLanes.map((lane) => {
            const meta = laneMeta[lane];
            const Icon = meta.icon;
            return (
              <div key={lane} className="rounded-lg border border-[#326273]/14 bg-white/75 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Icon className={`h-5 w-5 ${meta.tone}`} />
                  <span className="text-2xl font-black text-[#1F4452]">{queueView.totals[lane]}</span>
                </div>
                <p className="mt-3 text-sm font-black text-[#326273]">{meta.label}</p>
              </div>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-lg border border-[#326273]/16 bg-white/80">
          <div className="grid grid-cols-[1.3fr_0.9fr_0.7fr_0.7fr_0.8fr_0.8fr] gap-0 border-b border-[#326273]/12 bg-[#1F4452] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/75">
            <span>Proposal</span>
            <span>Kind</span>
            <span>Impact</span>
            <span>Approvers</span>
            <span>Risk</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-[#326273]/10">
            {queueView.lanes.PENDING_APPROVALS.map((item) => (
              <div key={item.proposal.id} className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[1.3fr_0.9fr_0.7fr_0.7fr_0.8fr_0.8fr] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileWarning className="h-4 w-4 text-[#E39774]" />
                    <strong className="truncate text-sm text-[#1F4452]">{item.proposal.explain.recommendation}</strong>
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-[#326273]/65">{item.proposal.id} · maker {item.proposal.createdBy}</p>
                </div>
                <span className="text-sm font-bold text-[#326273]">{item.proposal.kind}</span>
                <span className="text-sm font-black text-[#1F4452]">{formatAmount(item.proposal)}</span>
                <span className="text-sm font-bold text-[#326273]">{item.approvalsCollected}/{item.requiredApprovers}</span>
                <span className={`w-fit rounded-md border px-2 py-1 text-xs font-black ${riskClass(item.proposal.explain.risk)}`}>{item.proposal.explain.risk}</span>
                <div className="flex items-center gap-2">
                  <button type="button" title="Approve" className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1F4452] text-white">
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                  <button type="button" title="Reject" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E39774]/50 text-[#9A4A2D]">
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {queueLanes.filter((lane) => lane !== 'PENDING_APPROVALS').map((lane) => {
            const meta = laneMeta[lane];
            const Icon = meta.icon;
            return (
              <div key={lane} className="rounded-lg border border-[#326273]/14 bg-white/72">
                <div className="flex items-center justify-between border-b border-[#326273]/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${meta.tone}`} />
                    <h2 className="text-sm font-black text-[#1F4452]">{meta.label}</h2>
                  </div>
                  <span className="text-sm font-black text-[#326273]">{queueView.totals[lane]}</span>
                </div>
                <div className="divide-y divide-[#326273]/10">
                  {queueView.lanes[lane].map((item) => (
                    <div key={`${lane}-${item.proposal.id}`} className="grid gap-2 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="min-w-0 truncate text-[#1F4452]">{item.proposal.explain.recommendation}</strong>
                        <span className="shrink-0 text-xs font-black text-[#326273]/60">{formatExpiry(item.expiresInMs)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#326273]/65">
                        <span>{item.proposal.kind}</span>
                        <span>{formatAmount(item.proposal)}</span>
                        <span>{item.reasons[0]}</span>
                      </div>
                    </div>
                  ))}
                  {queueView.lanes[lane].length === 0 && (
                    <div className="px-4 py-5 text-sm font-semibold text-[#326273]/55">Clear</div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
