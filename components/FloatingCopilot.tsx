'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Send, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { streamCopilot } from '../lib/copilot-client';

// ─── Time-aware greeting ──────────────────────────────────────────────────────

function getGreeting(): { short: string; opening: string } {
  const h = new Date().getHours();
  if (h < 12) {
    return {
      short: 'Good morning',
      opening:
        "Good morning! Ready to start the day strong?\n\nI can help with today's PHP payroll batch, check corridor rates, monitor your treasury yield, or flag any compliance notes.",
    };
  }
  if (h < 17) {
    return {
      short: 'Good afternoon',
      opening:
        "Good afternoon! Your Friday PHP batch is on track.\n\nCurrent PHP rate 56.42 is within 0.3% of the 30-day best — ideal lock window is tomorrow 08:45 MYT. Anything I can help with?",
    };
  }
  return {
    short: 'Good evening',
    opening:
      "Good evening! End-of-day summary: all 8 corridors are healthy, treasury at $24,500 earning $3.22/day.\n\nAnything you'd like me to prep for tomorrow?",
  };
}

// ─── Compact AI responses ─────────────────────────────────────────────────────

const COMPACT_RESPONSES: { keywords: string[]; reply: string }[] = [
  {
    keywords: ['php', 'philippines', 'peso', 'payroll', 'friday'],
    reply:
      'USD→PHP: 56.42 · Fee: 0.80% · Settles in ~4.2 min\n\nRate is within 0.3% of your 30-day best. Optimal lock: tomorrow 08:45 MYT before the pre-open liquidity window closes.\n\nWant me to draft the Friday batch?',
  },
  {
    keywords: ['myr', 'malaysia', 'ringgit', 'bnm'],
    reply:
      'USD→MYR: 4.71 · Fee: 0.85% · BNM policy meeting Thursday ⚠\n\nRecommend locking before Wednesday close. Waiting until Thursday risks a ±0.8% move. Lock now to save ~$42 on a $5,000 transfer.',
  },
  {
    keywords: ['idr', 'indonesia', 'rupiah', 'jakarta'],
    reply:
      'USD→IDR: 16,284 · Fee: 0.90% · Fastest corridor at 3.0 min\n\nYour IDR volume is up 18% over 6 weeks. A weekly Wednesday batch would save ~$32/month. Want me to set that up?',
  },
  {
    keywords: ['treasury', 'yield', 'apy', 'earn', 'deposit', 'compound'],
    reply:
      'Smart Treasury earns Ondo USDY (T-bill) yield — ≈3.5% APY, variable.\n\nYour Available balance (USDC) stays 0% but instant. Withdrawals from Smart Treasury take 1–3 business days. Want me to prepare a move?',
  },
  {
    keywords: ['cheapest', 'corridor', 'rate', 'compare', 'best'],
    reply:
      'This week by Splash fee:\n• PHP 0.80% · MYR/SGD 0.85% · IDR 0.90%\n• VND/THB 0.95% · EUR/GBP 1.10%\n\nPHP is your lowest-cost corridor. Batch transfers beat single-payment spreads on all corridors.',
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
      'USD→SGD: 1.345 · Fee: 0.85% · Settles in 6.1 min · MAS-regulated ✓\n\nSGD is stable this week. No urgent rate action needed.',
  },
];

const FALLBACK_REPLIES = [
  "I'm monitoring all 8 corridors — everything looks healthy today. What would you like to focus on?",
  'Your blended fee this month is 0.89%, saving you 41% vs. traditional wires. Anything to optimise?',
  'Smart Treasury earns variable Ondo USDY (T-bill) yield; Available stays instant at 0%. Want to move idle USDC in?',
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

const QUICK_CHIPS = [
  'PHP rate today?',
  'Draft Friday batch',
  'My treasury yield',
  'Compliance status',
];

function formatChatTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FloatingCopilot() {
  const [greeting,  setGreeting]  = useState('Hello');
  const [open,      setOpen]      = useState(false);
  const [input,     setInput]     = useState('');
  const [thinking,  setThinking]  = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [messages,  setMessages]  = useState<Message[]>([]);

  const msgIdRef          = useRef(1);
  const fallbackRef       = useRef(0);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef         = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLInputElement>(null);

  const busy = thinking || streaming;

  // Time-aware greeting + opening message — populated on the client only, so the
  // server-rendered HTML (UTC/stable) matches first paint and avoids a hydration
  // mismatch. getGreeting()/formatChatTime() depend on the local clock/timezone.
  useEffect(() => {
    const timer = setTimeout(() => {
      const g = getGreeting();
      setGreeting(g.short);
      setMessages((prev) => (prev.length ? prev : [{ id: 1, role: 'assistant', text: g.opening, time: formatChatTime() }]));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

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
        style={{ height: 480 }}
      >
        {/* Panel header */}
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-[#0c3e48] to-[#0d6370] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#efc46f]/25 ring-1 ring-[#efc46f]/40">
              <Bot size={14} className="text-[#efc46f]" />
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

        {/* Quick chips */}
        <div className="shrink-0 border-t border-[#326273]/8 px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={busy}
                onClick={() => sendMessage(chip)}
                className="shrink-0 rounded-full border border-[#326273]/10 bg-[#F6F0ED] px-2 py-1 text-[10px] font-medium text-[#326273]/70 transition-colors hover:border-[#5C9EAD]/40 hover:text-[#326273] disabled:opacity-40"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-[#326273]/8 p-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex items-center gap-2 rounded-xl bg-[#F6F0ED] px-3 py-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about rates, batches, treasury…"
              disabled={busy}
              className="flex-1 bg-transparent text-xs text-[#1F4452] placeholder-[#326273]/35 outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#326273] text-white transition-colors hover:bg-[#264e5b] disabled:opacity-40"
            >
              <Send size={12} />
            </button>
          </form>
        </div>
      </div>

      {/* ── Floating trigger button ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close 0xWal' : `${greeting} — open 0xWal`}
        className={cn(
          'fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-full py-3 text-white shadow-[0_12px_30px_rgba(8,54,64,0.3)] transition-all duration-200 hover:shadow-[0_16px_38px_rgba(8,54,64,0.36)]',
          open ? 'bg-[#0c3e48] px-3.5' : 'bg-[#0c3e48] px-4 hover:brightness-110'
        )}
      >
        {/* Bot icon */}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#efc46f]/25 ring-1 ring-[#efc46f]/40">
          <Bot size={15} className="text-[#efc46f]" />
        </div>

        {/* Label (only when closed) */}
        {!open && (
          <span className="text-sm font-semibold tracking-tight">
            {greeting}! <span className="opacity-75">👋</span>
          </span>
        )}

        {/* Collapse icon (only when open) */}
        {open && <ChevronDown size={16} className="text-white/70" />}

        {/* Live pulse dot (only when closed) */}
        {!open && (
          <span className="absolute -right-0.5 -top-0.5">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#efc46f] opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#efc46f]" />
            </span>
          </span>
        )}
      </button>
    </>
  );
}
