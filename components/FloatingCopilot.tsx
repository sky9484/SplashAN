'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Bot, ChevronDown, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { streamCopilot } from '../lib/copilot-client';
import OxWalComposer, { type OxWalComposerChip } from './oxwal/OxWalComposer';

// ─── Compact AI responses ─────────────────────────────────────────────────────

const COMPACT_RESPONSES: { keywords: string[]; reply: string }[] = [
  {
    keywords: ['php', 'philippines', 'peso', 'payroll', 'friday'],
    reply:
      'USD to PHP is the current testnet corridor. Starting edge fee is 0.80%; local delivery timing depends on the payout rail.\n\n0xWal can prepare a Friday batch, label the quote evidence, and leave approval with your team.',
  },
  {
    keywords: ['myr', 'malaysia', 'ringgit', 'bnm'],
    reply:
      'USD to MYR is modeled until partner activation. 0xWal can still prepare the route review: recipient, fee label, evidence, and approval steps.',
  },
  {
    keywords: ['idr', 'indonesia', 'rupiah', 'jakarta'],
    reply:
      'USD to IDR is a modeled expansion route. I can group candidate payouts, show the control checklist, and prepare an unsigned proposal when the rail is active.',
  },
  {
    keywords: ['treasury', 'yield', 'apy', 'earn', 'deposit', 'compound'],
    reply:
      'Smart Treasury earns a variable Ondo USDY (T-bill) yield.\n\nYour Available balance (USDC) stays 0% but instant. Withdrawals from Smart Treasury take 1–3 business days. Want me to prepare a projection?',
  },
  {
    keywords: ['cheapest', 'corridor', 'rate', 'compare', 'best'],
    reply:
      'Current fee labels: PHP starts at 0.80% on the testnet path. MYR, SGD, IDR, VND, THB, EUR, and GBP stay modeled until partner and regulatory controls are active.',
  },
  {
    keywords: ['compliance', 'kyb', 'aml', 'limit', 'flag'],
    reply:
      'Compliance: All clear ✓\n• KYB Tier 1 approved\n• AML: No flags\n• Daily limit: 43% used ($12,100 remaining)\n• Walrus audit: Active 7-yr retention\n\nNo action needed.',
  },
  {
    keywords: ['batch', 'payout', 'bulk'],
    reply:
      'Batch payout tip: your optimal window is Friday 09:00 MYT with ~52 recipients and $11,800 avg batch size.\n\nLocking Thursday 08:45 MYT saves ~$18 vs. Friday open on the current PHP rate.',
  },
  {
    keywords: ['sgd', 'singapore'],
    reply:
      'USD to SGD is modeled. I can prepare a route review, but execution should stay blocked until the partner rail and compliance controls are active.',
  },
];

const FALLBACK_REPLIES = [
  "I'm monitoring the live PHP testnet corridor and modeled expansion routes. What would you like to focus on?",
  'Your blended fee this month is 0.89%, saving you 41% vs. traditional wires. Anything to optimise?',
  'Smart Treasury models a variable Ondo USDY return; execution stays approval-gated. Want a projection?',
  'All systems clear — no AML flags, no compliance issues. What can I help with?',
];

function matchCompactResponse(
  input: string,
  fallbackRef: React.MutableRefObject<number>
): string {
  const q = String(input ?? '').toLowerCase();
  for (const { keywords, reply } of COMPACT_RESPONSES) {
    if (keywords.some((k) => q.includes(k))) return reply;
  }
  const idx = fallbackRef.current % FALLBACK_REPLIES.length;
  fallbackRef.current++;
  return FALLBACK_REPLIES[idx];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = { id: number; role: 'user' | 'assistant'; text: string; time: string };

const QUICK_CHIPS: OxWalComposerChip[] = [
  { label: 'PHP rate', prompt: 'PHP rate today?', icon: 'search' },
  { label: 'Draft batch', prompt: 'Draft Friday batch', icon: 'write' },
  { label: 'Treasury yield', prompt: 'My treasury yield', icon: 'file' },
  { label: 'Compliance', prompt: 'Compliance status', icon: 'search' },
];

const NUDGES = ['Hi!', 'Can I help?', 'Ready to splash it?'];
const OPENING_MESSAGE =
  'Hi! I can help with rates, batches, treasury, compliance, and settlement proof.';

function formatChatTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FloatingCopilot() {
  const [open,      setOpen]      = useState(false);
  const [input,     setInput]     = useState('');
  const [thinking,  setThinking]  = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [nudge, setNudge] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const msgIdRef          = useRef(1);
  const fallbackRef       = useRef(0);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeTimeoutRef    = useRef<number | null>(null);
  const dragRef            = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const scrollRef         = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLInputElement>(null);

  const busy = thinking || streaming;

  // Populate the first message on the client to keep the timestamp hydration-safe.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMessages((prev) => (
        prev.length ? prev : [{ id: 1, role: 'assistant', text: OPENING_MESSAGE, time: formatChatTime() }]
      ));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // A brief, low-pressure prompt appears every 45 seconds while the chat is closed.
  useEffect(() => {
    const showNudge = () => {
      if (open) return;
      setNudge((current) => {
        const choices = NUDGES.filter((item) => item !== current);
        return choices[Math.floor(Math.random() * choices.length)] ?? NUDGES[0];
      });
      if (nudgeTimeoutRef.current) window.clearTimeout(nudgeTimeoutRef.current);
      nudgeTimeoutRef.current = window.setTimeout(() => setNudge(null), 3000);
    };
    const interval = window.setInterval(showNudge, 45_000);
    return () => {
      window.clearInterval(interval);
      if (nudgeTimeoutRef.current) window.clearTimeout(nudgeTimeoutRef.current);
    };
  }, [open]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, thinking, open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    };
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const nextX = dragRef.current.offsetX + event.clientX - dragRef.current.x;
    const nextY = dragRef.current.offsetY + event.clientY - dragRef.current.y;
    const maxX = Math.max(0, window.innerWidth - 90);
    const maxY = Math.max(0, window.innerHeight - 140);
    setOffset({
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    });
  }

  function stopDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const now = formatChatTime();
    const userMsgId = ++msgIdRef.current;

    const history = messages.map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', text: trimmed, time: now }]);
    setInput('');
    setThinking(true);

    void (async () => {
      const assistantMsgId = ++msgIdRef.current;
      let started = false;
      const startAssistant = () => {
        if (started) return;
        started = true;
        setThinking(false);
        setStreaming(true);
        setMessages((prev) => [
          ...prev,
          { id: assistantMsgId, role: 'assistant', text: '', time: formatChatTime() },
        ]);
      };

      // Real streaming via /api/copilot/chat (MemWal recall + reply); local fallback.
      const ok = await streamCopilot(trimmed, history, {
        onDelta: (t) => {
          startAssistant();
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, text: m.text + t } : m))
          );
        },
        onDone: () => setStreaming(false),
      });

      if (ok) {
        setStreaming(false);
        return;
      }

      const reply = matchCompactResponse(trimmed, fallbackRef);
      startAssistant();
      let charIdx = 0;
      streamIntervalRef.current = setInterval(() => {
        charIdx += 4;
        if (charIdx >= reply.length) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, text: reply } : m))
          );
          clearInterval(streamIntervalRef.current!);
          streamIntervalRef.current = null;
          setStreaming(false);
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, text: reply.slice(0, charIdx) } : m
            )
          );
        }
      }, 18);
    })();
  }

  return (
    <>
      {/* ── Chat panel (slides up above the button) ── */}
      <div
        className={cn(
          'fixed bottom-[76px] right-4 z-50 flex w-[360px] flex-col overflow-hidden rounded-2xl border border-[#0c3e48]/12 bg-[#fffdf9] shadow-[0_24px_60px_rgba(8,54,64,0.28)] transition-all duration-200 origin-bottom-right',
          open
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none'
        )}
        style={{ height: 480, translate: `${offset.x}px ${offset.y}px` }}
      >
        {/* Panel header */}
        <div
          className="flex shrink-0 cursor-grab touch-none items-center justify-between bg-gradient-to-r from-[#0c3e48] to-[#0d6370] px-4 py-3 active:cursor-grabbing"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          aria-label="Drag 0xWal chat"
        >
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_50%_35%,#eaf6f1,#cfe8e0)] ring-1 ring-[#efc46f]/40">
              <Image src="/cinematic/agent-bot-cut.png" alt="" width={512} height={512} className="h-6 w-auto" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">0xWal</div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/50">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    busy ? 'animate-pulse bg-amber-400' : 'bg-emerald-400'
                  )}
                />
                {thinking ? 'Thinking…' : streaming ? 'Typing…' : 'Online · MemWal synced'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <Sparkles size={9} /> Claude
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-white/50 transition-colors hover:text-white"
              aria-label="Close 0xWal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto p-3"
          style={{ scrollbarWidth: 'none' }}
        >
          {messages.map((msg, i) => {
            const isStreamingThis =
              msg.role === 'assistant' && i === messages.length - 1 && streaming;
            return (
              <div
                key={msg.id}
                className={cn('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : '')}
              >
                {msg.role === 'assistant' && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E39774]/15">
                    <Bot size={11} className="text-[#C97A56]" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[82%] rounded-2xl px-3 py-2 text-[11px] leading-[1.45]',
                    msg.role === 'assistant'
                      ? 'border border-[#0c3e48]/8 bg-white text-[#0c3e48] shadow-sm'
                      : 'bg-[#0c3e48] text-white'
                  )}
                >
                  {isStreamingThis ? (
                    <span className="whitespace-pre-wrap">
                      {msg.text}
                      <span className="ml-0.5 inline-block h-2.5 w-0.5 animate-pulse bg-[#326273]/50" />
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.text}</span>
                  )}
                  <div
                    className={cn(
                      'mt-0.5 text-[9px]',
                      msg.role === 'assistant' ? 'text-[#326273]/35' : 'text-white/40'
                    )}
                  >
                    {msg.time}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Thinking dots */}
          {thinking && (
            <div className="flex gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E39774]/15">
                <Bot size={11} className="text-[#C97A56]" />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl bg-[#F6F0ED] px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#326273]/40 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#326273]/40 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#326273]/40 [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#326273]/8 bg-[#fffdf9] p-3">
          <OxWalComposer
            compact
            value={input}
            onChange={setInput}
            onSubmit={() => sendMessage(input)}
            onChipSubmit={(prompt) => sendMessage(prompt)}
            chips={QUICK_CHIPS}
            disabled={busy}
            placeholder="Ask 0xWal anything"
            priorityLabel="High"
            inputRef={inputRef}
          />
        </div>
      </div>

      {/* ── Floating trigger: the 0xWal robot mascot ── */}
      <div className="fixed bottom-4 right-4 z-50 flex items-end gap-2.5">
        {/* Nudge bubble (closed only) */}
        {!open && nudge && (
          <span className="mb-2 animate-[copilot-nudge_.3s_ease] rounded-2xl rounded-br-sm bg-[#0c3e48] px-3.5 py-2 text-sm font-semibold tracking-tight text-white shadow-[0_10px_24px_rgba(8,54,64,0.3)]">
            {nudge}
          </span>
        )}

        <button
          type="button"
          onClick={() => {
            setNudge(null);
            setOpen((v) => !v);
          }}
          aria-label={open ? 'Close 0xWal' : 'Open 0xWal'}
          className={cn(
            'group relative grid h-16 w-16 place-items-center rounded-full ring-1 transition-all duration-200 hover:-translate-y-1',
            'bg-[radial-gradient(circle_at_50%_35%,#eaf6f1,#cfe8e0)] ring-[#0c3e48]/12',
            'shadow-[0_14px_30px_rgba(8,54,64,0.32)] hover:shadow-[0_20px_40px_rgba(8,54,64,0.4)]'
          )}
        >
          {/* Robot mascot — floats gently, tips forward on hover */}
          <Image
            src="/cinematic/agent-bot-cut.png"
            alt=""
            width={512}
            height={512}
            priority
            className={cn(
              'h-[54px] w-auto origin-bottom drop-shadow-[0_4px_6px_rgba(8,54,64,0.28)] transition-transform duration-200',
              open ? 'scale-90' : 'animate-[copilot-bob_3s_ease-in-out_infinite] group-hover:-rotate-6'
            )}
          />

          {/* Collapse chevron badge (open only) */}
          {open && (
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-[#0c3e48] text-white ring-2 ring-[#eaf6f1]">
              <ChevronDown size={14} />
            </span>
          )}

          {/* Live pulse dot (closed only) */}
          {!open && (
            <span className="absolute right-1 top-1">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#efc46f] opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[#efc46f] ring-2 ring-white/70" />
              </span>
            </span>
          )}
        </button>
      </div>
    </>
  );
}
