'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RotateCcw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import ActionCard from '@/components/oxwal/ActionCard';
import OxWalComposer, { type OxWalComposerChip } from '@/components/oxwal/OxWalComposer';
import MemWalBehaviorCard from '@/components/MemWalBehaviorCard';
import { stashBatchDraft } from '@/lib/batch-parse';
import { recordPendingProposals } from '@/lib/oxwal-notify';
import type { ActionCardProposal } from '@/lib/agent/action-card';

/**
 * 0xWal desk — a Claude-style expanding chat.
 *
 * Fresh desk: a centered composer ("What's on the agenda today?").
 * First message: the surface becomes a conversation — the thread grows
 * downward and the composer docks at the bottom, exactly like starting a chat.
 *
 * Everything the agent does surfaces INSIDE the thread, in operator language:
 * reads become quiet activity lines, warnings become amber notes, and every
 * prepared proposal appears as an unsigned action card the operator can read
 * but not act on here — approval always happens in the queue.
 */

type ThreadItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'activity'; id: string; label: string; tone: 'read' | 'propose' }
  | { kind: 'notice'; id: string; text: string; retryPrompt?: string }
  | { kind: 'session-expired'; id: string }
  | { kind: 'proposal'; id: string; proposal: ActionCardProposal };

type OxwalStreamEvent =
  | { type: 'meta'; source: 'claude' | 'local'; readTools: string[]; proposeTools: string[] }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; category: 'READ' | 'PROPOSE' }
  | { type: 'warning'; warning: { code: string; message: string; ref?: string } }
  | { type: 'proposal'; proposal: ActionCardProposal }
  | { type: 'done' };

const quickPrompts: OxWalComposerChip[] = [
  { label: 'Review invoice', prompt: 'Pay invoice inv_demo_acme_5000 to cp_acme_ph', icon: 'file' },
  { label: 'Allocate treasury', prompt: 'Allocate idle treasury for MY_PH', icon: 'write' },
  { label: 'Look up tools', prompt: 'What can you read and prepare?', icon: 'search' },
];

/** The operator sees what 0xWal is doing, never which backend does it. */
const activityLabels: Record<string, string> = {
  getBalances: 'Reading balances',
  getTreasuryState: 'Reading treasury state',
  getCorridorLiquidity: 'Checking corridor liquidity',
  getRate: 'Fetching FX rate',
  getCounterparty: 'Verifying counterparty',
  getInvoice: 'Reading invoice',
  getNettingOpportunities: 'Scanning netting opportunities',
  getComplianceStatus: 'Checking compliance',
  proposePayment: 'Preparing payment proposal',
  proposeInternalTransfer: 'Preparing internal transfer',
  proposeFxConvert: 'Preparing FX conversion',
  proposeTreasuryAllocation: 'Preparing treasury allocation',
  proposeTreasuryRedeem: 'Preparing treasury redemption',
  proposeNettingSettlement: 'Preparing netting settlement',
  proposeBatchPayout: 'Preparing batch payout',
};

const WELCOME =
  '0xWal is standing by. Every money movement becomes an unsigned proposal for human approval.';

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function OxwalDeskPage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [thread, setThread] = useState<ThreadItem[]>([
    { kind: 'assistant', id: 'assistant_welcome', text: WELCOME },
  ]);
  const [streamingText, setStreamingText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const hasStarted = thread.some((item) => item.kind === 'user');

  const proposals = useMemo(
    () => thread.flatMap((item) => (item.kind === 'proposal' ? [item.proposal] : [])),
    [thread],
  );

  const deskStats = useMemo(() => {
    const needsApproval = proposals.filter(
      (proposal) => proposal.explain.requiredApprovers > proposal.approvals.length,
    ).length;
    const warnings = thread.filter((item) => item.kind === 'notice').length;
    return { total: proposals.length, needsApproval, warnings };
  }, [proposals, thread]);

  // Let the floating 0xWal remind the operator elsewhere in the app. Every
  // streamed proposal is unsigned work until a human settles it in the queue.
  useEffect(() => {
    if (proposals.length > 0) {
      recordPendingProposals({ count: proposals.length, label: proposals[proposals.length - 1].explain.recommendation });
    }
  }, [proposals]);

  // Keep the newest turn in view while the conversation grows or streams.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thread, streamingText]);

  async function submitPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim();
    if (!prompt || isSending) return;

    const history = thread
      .flatMap((item) =>
        item.kind === 'user' || item.kind === 'assistant'
          ? [{ role: item.kind, content: item.text }]
          : [],
      )
      .slice(-8);

    setInput('');
    setStreamingText('');
    setIsSending(true);
    setThread((current) => [...current, { kind: 'user', id: newId('user'), text: prompt }]);

    let assistantText = '';
    try {
      const response = await fetch('/api/oxwal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          orgId: 'demo-business',
          actorId: 'operator-1',
          history,
        }),
      });

      if (response.status === 401) {
        setThread((current) => [...current, { kind: 'session-expired', id: newId('expired') }]);
        return;
      }
      if (!response.ok || !response.body) {
        setThread((current) => [
          ...current,
          {
            kind: 'notice',
            id: newId('notice'),
            text: '0xWal could not open a secure line just now. Nothing was prepared — try again.',
            retryPrompt: prompt,
          },
        ]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const flushAssistant = () => {
        const text = assistantText.trim();
        if (text) {
          setThread((current) => [...current, { kind: 'assistant', id: newId('assistant'), text }]);
        }
        assistantText = '';
        setStreamingText('');
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as OxwalStreamEvent;

          if (event.type === 'tool') {
            // A tool call means the current text turn ended — commit it so the
            // activity line lands between turns, in order.
            flushAssistant();
            setThread((current) => [
              ...current,
              {
                kind: 'activity',
                id: newId('tool'),
                label: activityLabels[event.name] ?? 'Working',
                tone: event.category === 'PROPOSE' ? 'propose' : 'read',
              },
            ]);
          }

          if (event.type === 'warning') {
            flushAssistant();
            setThread((current) => [
              ...current,
              { kind: 'notice', id: newId('notice'), text: event.warning.message },
            ]);
          }

          if (event.type === 'proposal') {
            flushAssistant();
            setThread((current) => [
              ...current,
              { kind: 'proposal', id: newId('proposal'), proposal: event.proposal },
            ]);
          }

          if (event.type === 'delta') {
            assistantText += event.text;
            setStreamingText(assistantText);
          }
        }
      }

      flushAssistant();
    } catch {
      setThread((current) => [
        ...current,
        {
          kind: 'notice',
          id: newId('notice'),
          text: 'The connection dropped mid-answer. Nothing was prepared without you — try again.',
          retryPrompt: prompt,
        },
      ]);
    } finally {
      setStreamingText('');
      setIsSending(false);
    }
  }

  function handleSubmit() {
    void submitPrompt(input);
  }

  const composer = (
    <OxWalComposer
      compact={hasStarted}
      title={hasStarted ? undefined : "What's on the agenda today?"}
      value={input}
      onChange={setInput}
      onSubmit={handleSubmit}
      onChipSubmit={(prompt) => void submitPrompt(prompt)}
      onFilePrepared={(batch) => {
        stashBatchDraft(batch);
        router.push('/dashboard/batch?draft=1');
      }}
      chips={hasStarted ? [] : quickPrompts}
      disabled={isSending}
      placeholder="Ask 0xWal to read, prepare, or explain — or attach a payout sheet"
    />
  );

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <main className="min-w-0 space-y-4">
        <header className="dash-block dash-block-accent dash-reveal p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="dash-kicker">Operating desk · AI</span>
                <span className="inline-flex items-center gap-2 rounded-md bg-[#0c3e48] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  0xWal online
                </span>
              </div>
              <h1 className="dash-title mt-3 text-3xl md:text-4xl">Finance command desk</h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[#326273]/62">
                Read financial state, prepare unsigned proposals, and route approvals from one operating surface.
              </p>
            </div>
            <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-[#326273]/14 bg-white text-center md:w-auto md:min-w-[300px]">
              <DeskStat label="Proposals" value={deskStats.total} />
              <DeskStat label="Approval" value={deskStats.needsApproval} caution={deskStats.needsApproval > 0} />
              <DeskStat label="Notices" value={deskStats.warnings} caution={deskStats.warnings > 0} />
            </div>
          </div>
        </header>

        {/* The chat surface. Starts as a centered composer; the first message
            expands it into a full conversation with the composer docked below. */}
        {!hasStarted ? (
          <section className="dash-surface dash-reveal px-4 py-10 md:px-8 md:py-14">
            {composer}
          </section>
        ) : (
          <section className="dash-surface dash-reveal flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[#326273]/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <BotAvatar size={24} />
                <h2 className="text-sm font-black text-[#1F4452]">0xWal</h2>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#326273]/45">
                  prepares · you approve
                </span>
              </div>
              <Link href="/queue" className="text-xs font-black text-[#326273] underline-offset-4 hover:underline">
                Approval queue
              </Link>
            </div>

            <div
              ref={threadRef}
              className="max-h-[62vh] min-h-[380px] space-y-3 overflow-y-auto p-4"
              aria-live="polite"
            >
              {thread.map((item) => (
                <ThreadRow key={item.id} item={item} onRetry={(prompt) => void submitPrompt(prompt)} />
              ))}

              {streamingText && (
                <div className="flex gap-2">
                  <BotAvatar />
                  <div className="max-w-[88%] rounded-lg rounded-tl-sm border border-[#5C9EAD]/30 bg-[#5C9EAD]/10 px-3 py-2 text-sm font-semibold leading-6 text-[#326273]">
                    <span className="whitespace-pre-wrap">{streamingText}</span>
                    <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-[#0d6370]/60" aria-hidden="true" />
                  </div>
                </div>
              )}

              {isSending && !streamingText && (
                <div className="flex gap-2">
                  <BotAvatar />
                  <div className="flex items-center gap-1.5 rounded-lg rounded-tl-sm border border-[#326273]/10 bg-[#F6F0ED] px-3 py-2.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0d6370]/50 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0d6370]/50 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0d6370]/50 [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-[#326273]/10 bg-white/60 p-3">{composer}</div>
          </section>
        )}
      </main>

      <aside className="space-y-4 dash-reveal-stagger">
        <MemWalBehaviorCard compact />
        <div className="dash-block p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#5C9EAD]" />
            <h2 className="text-sm font-black text-[#1F4452]">Control state</h2>
          </div>
          <div className="mt-3 divide-y divide-[#326273]/10 text-sm">
            <ControlRow icon={CheckCircle2} label="Tool boundary" value="Read + propose" />
            <ControlRow icon={Clock3} label="Submit guard" value="Policy re-check" />
            <ControlRow icon={AlertTriangle} label="Circuit breaker" value="Armed" />
          </div>
        </div>
        <div className="rounded-2xl border border-[#0c3e48] bg-[#0c3e48] p-4 text-white shadow-[6px_7px_0_rgba(12,62,72,0.18)]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#efc46f]/80">Approval surface</p>
          <div className="mt-2 text-2xl font-black">Maker-checker</div>
          {deskStats.needsApproval > 0 ? (
            <p className="mt-2 text-xs font-semibold leading-5 text-white/78">
              {deskStats.needsApproval} unsigned {deskStats.needsApproval === 1 ? 'proposal is' : 'proposals are'} waiting
              for your approval.
            </p>
          ) : (
            <p className="mt-2 text-xs font-semibold leading-5 text-white/62">
              Pending proposals, compliance holds, expiring quotes, failed settlements, and anomaly halts live in the queue.
            </p>
          )}
          <Link href="/queue" className="dash-btn dash-btn-gold mt-4">
            Open queue
          </Link>
        </div>
      </aside>
    </div>
  );
}

function ThreadRow({ item, onRetry }: { item: ThreadItem; onRetry: (prompt: string) => void }) {
  if (item.kind === 'user') {
    return (
      <div className="ml-auto max-w-[86%] rounded-lg rounded-tr-sm bg-[#1F4452] px-3 py-2 text-sm font-semibold leading-6 text-white">
        {item.text}
      </div>
    );
  }

  if (item.kind === 'assistant') {
    return (
      <div className="flex gap-2">
        <BotAvatar />
        <div className="max-w-[88%] whitespace-pre-wrap rounded-lg rounded-tl-sm border border-[#326273]/12 bg-[#F6F0ED] px-3 py-2 text-sm font-semibold leading-6 text-[#326273]">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === 'activity') {
    return (
      <div className="flex items-center gap-2 pl-8">
        <span
          className={
            item.tone === 'propose'
              ? 'inline-flex items-center gap-1.5 rounded-md border border-[#5C9EAD]/35 bg-[#5C9EAD]/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#326273]'
              : 'inline-flex items-center gap-1.5 rounded-md border border-[#326273]/14 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#326273]/70'
          }
        >
          <span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" />
          {item.label}
        </span>
      </div>
    );
  }

  if (item.kind === 'notice') {
    return (
      <div className="flex flex-wrap items-center gap-2 pl-8">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E39774]/55 bg-[#E39774]/15 px-2.5 py-1.5 text-xs font-bold leading-5 text-[#9A4A2D]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {item.text}
        </span>
        {item.retryPrompt && (
          <button
            type="button"
            onClick={() => onRetry(item.retryPrompt!)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#326273]/20 bg-white px-2.5 py-1.5 text-xs font-black text-[#326273] transition hover:border-[#5C9EAD]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </button>
        )}
      </div>
    );
  }

  if (item.kind === 'session-expired') {
    return (
      <div className="flex flex-wrap items-center gap-2 pl-8">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E39774]/55 bg-[#E39774]/15 px-2.5 py-1.5 text-xs font-bold leading-5 text-[#9A4A2D]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Your session ended, so 0xWal paused. Sign in again to pick up where you left off.
        </span>
        <Link
          href="/login"
          className="rounded-md bg-[#1F4452] px-2.5 py-1.5 text-xs font-black text-white transition hover:bg-[#326273]"
        >
          Sign in again
        </Link>
      </div>
    );
  }

  // Unsigned proposal — readable in the thread, actionable only in the queue.
  const proposal = item.proposal;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 pl-8">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[#efc46f]/60 bg-[#efc46f]/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#9A4A2D]">
          Unsigned · sent to approval queue
        </span>
      </div>
      <ActionCard key={proposal.id} proposal={proposal} readOnly />
    </div>
  );
}

function BotAvatar({ size = 24 }: { size?: number }) {
  return (
    <div
      className="mt-0.5 grid shrink-0 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_50%_35%,#eaf6f1,#cfe8e0)] ring-1 ring-[#0d6370]/25"
      style={{ height: size, width: size }}
    >
      <Image src="/cinematic/agent-bot-cut.png" alt="" width={512} height={512} style={{ height: size * 0.66, width: 'auto' }} />
    </div>
  );
}

function DeskStat({ label, value, caution = false }: { label: string; value: number; caution?: boolean }) {
  return (
    <div className="min-w-0 border-r border-[#326273]/10 px-3 py-2 last:border-r-0">
      <div className={caution ? 'text-2xl font-black text-[#E39774]' : 'text-2xl font-black text-[#1F4452]'}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-black uppercase tracking-normal text-[#326273]/50">{label}</div>
    </div>
  );
}

function ControlRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#5C9EAD]" />
        <span className="font-black text-[#326273]">{label}</span>
      </div>
      <span className="font-mono text-xs font-black text-[#1F4452]">{value}</span>
    </div>
  );
}
