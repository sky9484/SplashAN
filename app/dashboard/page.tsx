'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import ActionCard from '@/components/oxwal/ActionCard';
import OxWalComposer, { type OxWalComposerChip } from '@/components/oxwal/OxWalComposer';
import MemWalBehaviorCard from '@/components/MemWalBehaviorCard';
import type { ActionCardProposal } from '@/lib/agent/action-card';

type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type DeskEvent = {
  id: string;
  label: string;
  tone: 'read' | 'propose' | 'warning' | 'meta';
};

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

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function eventToneClass(tone: DeskEvent['tone']) {
  if (tone === 'warning') return 'border-[#E39774]/55 bg-[#E39774]/15 text-[#9A4A2D]';
  if (tone === 'propose') return 'border-[#5C9EAD]/35 bg-[#5C9EAD]/10 text-[#326273]';
  if (tone === 'read') return 'border-[#326273]/18 bg-white text-[#326273]';
  return 'border-[#326273]/14 bg-[#F6F0ED] text-[#326273]/70';
}

export default function OxwalDeskPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      id: 'assistant_welcome',
      role: 'assistant',
      content: '0xWal is standing by. Every money movement becomes an unsigned proposal for human approval.',
    },
  ]);
  const [streamingText, setStreamingText] = useState('');
  const [proposals, setProposals] = useState<ActionCardProposal[]>([]);
  const [events, setEvents] = useState<DeskEvent[]>([]);
  const [source, setSource] = useState<'claude' | 'local' | null>(null);
  const [isSending, setIsSending] = useState(false);

  const proposalStats = useMemo(() => {
    const needsApproval = proposals.filter((proposal) => proposal.explain.requiredApprovers > proposal.approvals.length).length;
    const warnings = events.filter((event) => event.tone === 'warning').length;
    return { total: proposals.length, needsApproval, warnings };
  }, [events, proposals]);

  async function submitPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim();
    if (!prompt || isSending) return;

    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setInput('');
    setStreamingText('');
    setIsSending(true);
    setMessages((current) => [...current, { id: newId('user'), role: 'user', content: prompt }]);

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
      if (!response.ok || !response.body) {
        throw new Error('0xWal stream failed to open');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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

          if (event.type === 'meta') {
            setSource(event.source);
            setEvents((current) => [
              { id: newId('meta'), label: `${event.source} - ${event.readTools.length} read tools - ${event.proposeTools.length} propose tools`, tone: 'meta' as const },
              ...current,
            ].slice(0, 10));
          }

          if (event.type === 'tool') {
            setEvents((current) => [
              { id: newId('tool'), label: `${event.category}: ${event.name}`, tone: (event.category === 'PROPOSE' ? 'propose' : 'read') as DeskEvent['tone'] },
              ...current,
            ].slice(0, 10));
          }

          if (event.type === 'warning') {
            setEvents((current) => [
              { id: newId('warning'), label: `${event.warning.code}: ${event.warning.message}`, tone: 'warning' as const },
              ...current,
            ].slice(0, 10));
          }

          if (event.type === 'proposal') {
            setProposals((current) => [event.proposal, ...current]);
          }

          if (event.type === 'delta') {
            assistantText += event.text;
            setStreamingText(assistantText);
          }
        }
      }

      if (assistantText.trim()) {
        setMessages((current) => [...current, { id: newId('assistant'), role: 'assistant', content: assistantText.trim() }]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '0xWal request failed';
      setEvents((current) => [{ id: newId('warning'), label: message, tone: 'warning' as const }, ...current].slice(0, 10));
    } finally {
      setStreamingText('');
      setIsSending(false);
    }
  }

  function handleSubmit() {
    void submitPrompt(input);
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <main className="min-w-0 space-y-4">
        <header className="dash-block dash-block-accent dash-reveal p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="dash-kicker">Operating desk · AI</span>
                <span className="inline-flex items-center gap-2 rounded-md bg-[#0c3e48] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                  <Bot className="h-3.5 w-3.5 text-[#efc46f]" />
                  0xWal
                </span>
                <span className="rounded-md border border-[#5C9EAD]/35 bg-[#5C9EAD]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#326273]">
                  {source ?? 'local'} mode
                </span>
              </div>
              <h1 className="dash-title mt-3 text-3xl md:text-4xl">
                Finance command desk
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[#326273]/62">
                Read financial state, prepare unsigned proposals, and route approvals from one operating surface.
              </p>
            </div>
            <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-[#326273]/14 bg-white text-center md:w-auto md:min-w-[300px]">
              <DeskStat label="Proposals" value={proposalStats.total} />
              <DeskStat label="Approval" value={proposalStats.needsApproval} caution={proposalStats.needsApproval > 0} />
              <DeskStat label="Warnings" value={proposalStats.warnings} caution={proposalStats.warnings > 0} />
            </div>
          </div>
        </header>

        <section className="dash-surface dash-reveal px-4 py-8 md:px-8 md:py-10">
          <OxWalComposer
            title="What's on the agenda today?"
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onChipSubmit={(prompt) => void submitPrompt(prompt)}
            chips={quickPrompts}
            disabled={isSending}
            placeholder="Ask 0xWal to read, prepare, or explain..."
          />
        </section>

        <section className="grid gap-4 dash-reveal-stagger lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="dash-surface overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[#326273]/10 px-4 py-3">
              <MessageSquareText className="h-4 w-4 text-[#5C9EAD]" />
              <h2 className="text-sm font-black text-[#1F4452]">Conversation</h2>
            </div>
            <div className="max-h-[520px] min-h-[360px] space-y-3 overflow-y-auto p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === 'user'
                    ? 'ml-auto max-w-[86%] rounded-lg bg-[#1F4452] px-3 py-2 text-sm font-semibold leading-6 text-white'
                    : 'max-w-[92%] rounded-lg border border-[#326273]/12 bg-[#F6F0ED] px-3 py-2 text-sm font-semibold leading-6 text-[#326273]'}
                >
                  {message.content}
                </div>
              ))}
              {streamingText && (
                <div className="max-w-[92%] rounded-lg border border-[#5C9EAD]/30 bg-[#5C9EAD]/10 px-3 py-2 text-sm font-semibold leading-6 text-[#326273]">
                  {streamingText}
                </div>
              )}
            </div>
          </div>

          <div className="dash-surface overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[#326273]/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-[#5C9EAD]" />
                <h2 className="text-sm font-black text-[#1F4452]">Agent events</h2>
              </div>
              <Link href="/queue" className="text-xs font-black text-[#326273]">Queue</Link>
            </div>
            <div className="grid max-h-[520px] min-h-[360px] content-start gap-2 overflow-y-auto p-4">
              {events.length === 0 && (
                <div className="rounded-lg border border-dashed border-[#326273]/18 p-6 text-center text-sm font-semibold text-[#326273]/55">
                  No events yet
                </div>
              )}
              {events.map((event) => (
                <div key={event.id} className={`rounded-md border px-3 py-2 text-xs font-black leading-5 ${eventToneClass(event.tone)}`}>
                  {event.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="dash-kicker">Unsigned proposals</span>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-[#0c3e48]">Action cards</h2>
            </div>
            <Link href="/dashboard/overview" className="dash-btn-ghost dash-btn">
              Overview
            </Link>
          </div>
          {proposals.length === 0 ? (
            <div className="dash-surface p-8 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-[#5C9EAD]" />
              <p className="mt-3 text-sm font-black text-[#1F4452]">No active proposals</p>
            </div>
          ) : (
            <div className="space-y-4">
              {proposals.map((proposal) => (
                <ActionCard key={proposal.id} proposal={proposal} />
              ))}
            </div>
          )}
        </section>
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
            <ControlRow icon={AlertTriangle} label="Circuit breaker" value="Armed" caution={false} />
          </div>
        </div>
        <div className="rounded-2xl border border-[#0c3e48] bg-[#0c3e48] p-4 text-white shadow-[6px_7px_0_rgba(12,62,72,0.18)]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#efc46f]/80">Approval surface</p>
          <div className="mt-2 text-2xl font-black">Maker-checker</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-white/62">
            Pending proposals, compliance holds, expiring quotes, failed settlements, and anomaly halts live in the queue.
          </p>
          <Link href="/queue" className="dash-btn dash-btn-gold mt-4">
            Open queue
          </Link>
        </div>
      </aside>
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

function ControlRow({ icon: Icon, label, value, caution = false }: { icon: LucideIcon; label: string; value: string; caution?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon className={caution ? 'h-4 w-4 text-[#E39774]' : 'h-4 w-4 text-[#5C9EAD]'} />
        <span className="font-black text-[#326273]">{label}</span>
      </div>
      <span className="font-mono text-xs font-black text-[#1F4452]">{value}</span>
    </div>
  );
}
