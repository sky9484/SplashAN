'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, PenLine, Send, ShieldCheck, XCircle } from 'lucide-react';

import { buildActionCardModel, type ActionCardProposal } from '@/lib/agent/action-card';

const actionLabels = {
  sign: 'Sign & approve',
  send: 'Send for approval',
  reject: 'Reject',
} as const;

function riskClass(tone: ReturnType<typeof buildActionCardModel>['riskTone']) {
  if (tone === 'high') return 'border-[#E39774]/55 bg-[#E39774]/15 text-[#9A4A2D]';
  if (tone === 'medium') return 'border-[#326273]/20 bg-white text-[#326273]';
  return 'border-[#5C9EAD]/35 bg-[#5C9EAD]/12 text-[#326273]';
}

function confidenceColor(tone: ReturnType<typeof buildActionCardModel>['riskTone'], hasUntrustedEvidence: boolean) {
  return tone === 'high' || hasUntrustedEvidence ? 'bg-[#E39774]' : 'bg-[#5C9EAD]';
}

type ActionCardProps = {
  proposal: ActionCardProposal;
  /** View-only rendering for the chat thread: approval actions live in the
   *  queue, so the buttons are replaced by a status note. */
  readOnly?: boolean;
};

export default function ActionCard({ proposal, readOnly = false }: ActionCardProps) {
  const model = buildActionCardModel(proposal);
  const confidenceTone = confidenceColor(model.riskTone, model.hasUntrustedEvidence);

  return (
    <article className="overflow-hidden rounded-lg border border-[#326273]/16 bg-white/86 shadow-[0_18px_38px_-30px_rgba(31,68,82,0.45)]">
      <div className="grid gap-4 border-b border-[#326273]/10 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#1F4452] px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">
              {proposal.kind}
            </span>
            <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${riskClass(model.riskTone)}`}>
              {proposal.explain.risk} risk
            </span>
            {model.hasUntrustedEvidence && (
              <span className="inline-flex items-center gap-1 rounded-md border border-[#E39774]/55 bg-[#E39774]/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#9A4A2D]">
                <AlertTriangle className="h-3.5 w-3.5" />
                Untrusted data
              </span>
            )}
          </div>
          <h2 className="mt-3 text-xl font-black tracking-normal text-[#1F4452]">
            {proposal.explain.recommendation}
          </h2>
          <p className="mt-1 font-mono text-xs font-semibold text-[#326273]/50">
            {proposal.id} - {proposal.status} - {proposal.corridor ?? 'NO_CORRIDOR'}
          </p>
        </div>

        <div className="min-w-[190px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#326273]/48">Confidence</span>
            <span className="font-mono text-sm font-black text-[#1F4452]">{model.confidencePercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#326273]/10">
            <div className={`h-full rounded-full ${confidenceTone}`} style={{ width: `${model.confidencePercent}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[#326273]/12 bg-[#F6F0ED] px-3 py-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#326273]/50">Approvers</span>
            <span className="font-mono text-sm font-black text-[#1F4452]">{model.approverText}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
        <section className="border-b border-[#326273]/10 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#1F4452]">
            <CheckCircle2 className="h-4 w-4 text-[#5C9EAD]" />
            Impact table
          </div>
          <div className="overflow-hidden rounded-md border border-[#326273]/12">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[#326273]/10">
                {model.impactRows.map((item) => (
                  <tr key={item.label}>
                    <th className="bg-[#F6F0ED] px-3 py-2 text-left text-xs font-black uppercase tracking-[0.12em] text-[#326273]/55">
                      {item.label}
                    </th>
                    <td className="px-3 py-2 text-right font-mono font-black text-[#1F4452]">{item.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#1F4452]">
            <ShieldCheck className="h-4 w-4 text-[#5C9EAD]" />
            Simulation deltas
          </div>
          <div className="divide-y divide-[#326273]/10 rounded-md border border-[#326273]/12">
            {model.simulationRows.map((item) => (
              <div key={`${item.label}-${item.value}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-semibold text-[#326273]/72">{item.label}</span>
                <span className={item.status === 'warning' ? 'font-mono font-black text-[#9A4A2D]' : 'font-mono font-black text-[#1F4452]'}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="border-t border-[#326273]/10 p-4">
        <div className="mb-3 text-sm font-black text-[#1F4452]">Evidence</div>
        <div className="flex flex-wrap gap-2">
          {model.evidenceRows.map((item) => (
            <span
              key={`${item.source}-${item.ref}`}
              className={item.tone === 'untrusted'
                ? 'rounded-md border border-[#E39774]/55 bg-[#E39774]/15 px-2.5 py-1 text-xs font-black text-[#9A4A2D]'
                : 'rounded-md border border-[#5C9EAD]/35 bg-[#5C9EAD]/10 px-2.5 py-1 text-xs font-black text-[#326273]'}
            >
              {item.source} - {item.trustLabel}
            </span>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t border-[#326273]/10 bg-[#F6F0ED]/70 p-4 md:flex-row md:items-center md:justify-between">
        <details className="group min-w-0 text-sm">
          <summary className="cursor-pointer font-black text-[#326273]">Reasoning trace</summary>
          <a
            href={`/api/walrus/${encodeURIComponent(proposal.explain.reasoningTraceRef)}`}
            className="mt-2 inline-flex max-w-full items-center gap-1 break-all font-mono text-xs font-semibold text-[#326273]/62"
          >
            {proposal.explain.reasoningTraceRef}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        </details>

        {readOnly ? (
          <span className="inline-flex items-center gap-2 rounded-md border border-[#326273]/16 bg-white px-3 py-2 font-mono text-xs font-bold uppercase tracking-[0.1em] text-[#326273]/70">
            <ShieldCheck className="h-4 w-4 text-[#5C9EAD]" />
            Approve or reject in the queue
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-[#1F4452] px-3 py-2 text-sm font-black text-white"
            >
              <PenLine className="h-4 w-4" />
              {model.primaryActionLabel}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-[#326273]/20 bg-white px-3 py-2 text-sm font-black text-[#326273]"
            >
              <Send className="h-4 w-4" />
              {actionLabels.send}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-[#E39774]/55 bg-[#E39774]/10 px-3 py-2 text-sm font-black text-[#9A4A2D]"
            >
              <XCircle className="h-4 w-4" />
              {actionLabels.reject}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
