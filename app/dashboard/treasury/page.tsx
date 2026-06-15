'use client';

import { useEffect, useRef, useState } from 'react';
import SettlementEngineFlow from '@/components/dashboard/SettlementEngineFlow';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Info,
  Landmark,
  Lock,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Sprout,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { cn } from '../../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type TxType = 'deposit' | 'withdraw' | 'yield';
type HistoryEntry = {
  id: string;
  type: TxType;
  desc: string;
  amount: string;
  amountNum: number;
  date: string;
  status: 'confirmed' | 'pending';
};

type WithdrawalNotice = {
  id: string;
  amount: number;
  availableAt: string;
};

type TreasurySnapshot = {
  available: number;
  treasuryPrincipal: number;
  treasuryYield: number;
  executionEnabled: boolean;
  rate: { apy: number; label: string; introductory: boolean };
  notices: Array<{ id: string; amount: number; availableAt: string }>;
};

type TreasuryRateView = { apy: number; label: string; introductory: boolean };

// ─── Seed data ──────────────────────────────────────────────────────────────

const SEED_HISTORY: HistoryEntry[] = [
  { id: 'tx_t001', type: 'yield',    desc: 'USDY yield accrual',              amount: '+$3.28',     amountNum:  3.28, date: 'Today, 00:01', status: 'confirmed' },
  { id: 'tx_t002', type: 'yield',    desc: 'USDY yield accrual',              amount: '+$3.25',     amountNum:  3.25, date: 'Yesterday',    status: 'confirmed' },
  { id: 'tx_t003', type: 'deposit',  desc: 'Available → Smart Treasury',      amount: '+$5,000.00', amountNum:  5000, date: '26 May 2026',  status: 'confirmed' },
  { id: 'tx_t004', type: 'yield',    desc: 'USDY yield accrual',              amount: '+$3.22',     amountNum:  3.22, date: '25 May 2026',  status: 'confirmed' },
  { id: 'tx_t006', type: 'withdraw', desc: 'Smart Treasury → Available',      amount: '-$2,000.00', amountNum: -2000, date: '23 May 2026',  status: 'confirmed' },
  { id: 'tx_t007', type: 'deposit',  desc: 'Available → Smart Treasury',      amount: '+$8,000.00', amountNum:  8000, date: '20 May 2026',  status: 'confirmed' },
];

const DAILY_BARS_7D = [
  { day: 'Mon', label: 'Mon · 19 May', amount: 3.18 },
  { day: 'Tue', label: 'Tue · 20 May', amount: 3.21 },
  { day: 'Wed', label: 'Wed · 21 May', amount: 3.19 },
  { day: 'Thu', label: 'Thu · 22 May', amount: 3.24 },
  { day: 'Fri', label: 'Fri · 23 May', amount: 3.22 },
  { day: 'Sat', label: 'Sat · 24 May', amount: 3.25 },
  { day: 'Sun', label: 'Sun · 25 May', amount: 3.28 },
];

const DAILY_BARS_30D = Array.from({ length: 30 }, (_, i) => {
  const base = 3.05 + (i / 30) * 0.3;
  const noise = Math.sin(i * 1.3) * 0.04 + Math.cos(i * 0.7) * 0.03;
  return { day: `D${i + 1}`, label: `Day ${i + 1} · ${i + 1} Apr 2026`, amount: +(base + noise).toFixed(2) };
});

const BAR_COLORS = ['#D9A441', '#E0B05A', '#E39774', '#6FB4A0', '#5C9EAD', '#C99A2E', '#D9A441'];

const RISK_ITEMS = [
  { label: 'Instrument',     value: 'Ondo USDY · US Treasury bills', icon: Landmark    },
  { label: 'Smart contract', value: 'Audited · Sui-native USDY',     icon: ShieldCheck },
  { label: 'Custody',        value: 'Segregated from operating',     icon: Lock        },
  { label: 'Liquidity',      value: 'USDC↔USDY swap on Sui DEX',     icon: Zap         },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowLabel() {
  return new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function HistIcon({ type }: { type: TxType }) {
  if (type === 'deposit')  return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#D9A441]/15"><ArrowUpRight size={14} className="text-[#C99A2E]" /></div>;
  if (type === 'withdraw') return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5C9EAD]/10"><ArrowDownLeft size={14} className="text-[#5C9EAD]" /></div>;
  return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6FB4A0]/18"><Sparkles size={14} className="text-[#4F9C88]" /></div>;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const [available, setAvailable]     = useState(11140.0); // USDC · 0% · instant
  const [balance, setBalance]         = useState(24500.0); // USDY · Smart Treasury
  const [yield30d, setYield30d]       = useState(98.72);
  const [rate, setRate]               = useState<TreasuryRateView>({ apy: 0, label: 'Variable rate loading...', introductory: false });
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const [history, setHistory]         = useState<HistoryEntry[]>(SEED_HISTORY);
  const [notices, setNotices]         = useState<WithdrawalNotice[]>([]);
  const [tab, setTab]                 = useState<'toTreasury' | 'toAvailable'>('toTreasury');
  const [amount, setAmount]           = useState('');
  const [toast, setToast]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [chartRange, setChartRange]   = useState<'7d' | '30d'>('7d');
  const [hoveredBar, setHoveredBar]   = useState<number | null>(null);
  const [nettingRatio, setNettingRatio] = useState(60);
  const counterRef                    = useRef(9);

  // Server-backed ledger: real two-bucket balances, floating rate, and notices.
  function applySnapshot(d: TreasurySnapshot) {
    setAvailable(d.available);
    setBalance(d.treasuryPrincipal);
    setYield30d(d.treasuryYield);
    setExecutionEnabled(d.executionEnabled === true);
    if (d.rate?.apy) setRate({ apy: d.rate.apy, label: d.rate.label, introductory: d.rate.introductory });
    setNotices((d.notices ?? []).map((n) => ({ id: n.id, amount: n.amount, availableAt: n.availableAt })));
  }

  useEffect(() => {
    let active = true;
    fetch('/api/treasury')
      .then((r) => (r.ok ? (r.json() as Promise<TreasurySnapshot>) : null))
      .then((d) => { if (active && d) applySnapshot(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Gentle live tick on accrued yield (cosmetic).
  useEffect(() => {
    const id = setInterval(() => {
      const tick = balance * (rate.apy / 100) / 365 / (24 * 60 / 0.05); // ~per tick
      setYield30d((v) => v + Math.max(tick, 0.002));
    }, 3000);
    return () => clearInterval(id);
  }, [balance, rate.apy]);

  const dailyYield  = balance * (rate.apy / 100) / 365;
  const projAnnual  = balance * (rate.apy / 100);

  const bars        = chartRange === '7d' ? DAILY_BARS_7D : DAILY_BARS_30D;
  const maxBar      = Math.max(...bars.map((d) => d.amount));
  const minBar      = Math.min(...bars.map((d) => d.amount));
  const totalRange  = bars.reduce((sum, d) => sum + d.amount, 0);
  const avgBar      = totalRange / bars.length;
  const focusBar    = hoveredBar !== null ? bars[hoveredBar] : null;

  const parsedAmount   = Number.parseFloat(amount);
  const validAmount    = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const sourceBalance  = tab === 'toTreasury' ? available : balance;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3600);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!executionEnabled) {
      showToast('Projection only - execution disabled pending regulatory approval.');
      return;
    }
    if (!validAmount) return;
    if (parsedAmount > sourceBalance) {
      showToast(tab === 'toTreasury' ? 'Insufficient Available balance' : 'Insufficient Smart Treasury balance');
      return;
    }
    setLoading(true);
    const action = tab === 'toTreasury' ? 'move' : 'withdraw';
    const id = `tx_t${String(counterRef.current++).padStart(3, '0')}`;
    fetch('/api/treasury', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, amountUsd: parsedAmount }),
    })
      .then(async (r) => {
        const d = (await r.json()) as TreasurySnapshot & { error?: string };
        if (!r.ok) throw new Error(d.error || 'Move failed');
        applySnapshot(d);
        if (action === 'move') {
          setHistory((prev) => [{ id, type: 'deposit', desc: 'Available → Smart Treasury', amount: `+$${fmtUsd(parsedAmount)}`, amountNum: parsedAmount, date: nowLabel(), status: 'confirmed' }, ...prev]);
          showToast(`$${fmtUsd(parsedAmount)} treasury allocation approved`);
        } else {
          setHistory((prev) => [{ id, type: 'withdraw', desc: 'Smart Treasury → Available (notice)', amount: `-$${fmtUsd(parsedAmount)}`, amountNum: -parsedAmount, date: nowLabel(), status: 'pending' }, ...prev]);
          showToast('Withdrawal requested · funds in Available in 1–3 business days');
        }
        setAmount('');
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'Move failed'))
      .finally(() => setLoading(false));
  }

  const previewSource = validAmount ? Math.max(0, sourceBalance - parsedAmount) : null;
  const simulationPrincipal = 5_000;
  const simulationFee = simulationPrincipal * 0.014 + 4.5;
  const feesDeleted = simulationFee * (nettingRatio / 100);
  const feesRelocated = simulationFee - feesDeleted;

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-[#0c3e48] px-4 py-3 text-sm font-semibold text-white shadow-xl">
          <CheckCircle2 size={15} className="text-[#6FB4A0]" /> {toast}
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="dash-kicker">Smart treasury</span>
          <h1 className="dash-title mt-2">Smart Treasury</h1>
          <p className="mt-1 text-xs font-medium text-[#326273]/60">
            Two-bucket simulation: Available USDC stays instant at 0%; Smart Treasury models a variable USDY return.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[#D9A441]/40 bg-[#D9A441]/12 px-3 py-1.5 text-sm font-bold text-[#9a6f15]">{rate.label}</span>
          {rate.introductory && (
            <span className="rounded-full border border-[#E39774]/40 bg-[#E39774]/12 px-3 py-1.5 text-xs font-bold text-[#C97A56]">Introductory rate</span>
          )}
        </div>
      </header>
      <div className="dash-block border-accent/30 bg-accent/10 p-4 text-sm font-bold text-foreground">
        Projection only — execution disabled pending regulatory approval.
        <span className="mt-1 block text-xs font-medium text-foreground/65">
          Customer funds are held 1:1 in segregated custody, never commingled, never lent, reconciled daily.
        </span>
      </div>

      {/* Signature: treasury flow */}
      <SettlementEngineFlow variant="treasury" className="dash-reveal" />

      {/* Two buckets */}
      <section className="grid gap-4 dash-reveal-stagger md:grid-cols-2">
        {/* Available — neutral, 0%, instant */}
        <div className="dash-block dash-block-interactive p-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#326273]/55">Available balance</span>
            <div className="rounded-lg bg-[#5C9EAD]/10 p-1.5"><Wallet size={14} className="text-[#5C9EAD]" /></div>
          </div>
          <div className="dash-num mt-2 text-3xl font-extrabold text-[#0c3e48]">${fmtUsd(available)}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-[#326273]/8 px-2 py-0.5 text-[#326273]/70">USDC</span>
            <span className="text-[#326273]/55">0% · instant · operating cash</span>
          </div>
        </div>

        {/* Smart Treasury projection — gold accent, USDY, variable, T+1–3 */}
        <div className="dash-block dash-block-accent dash-block-interactive p-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9a6f15]">Smart Treasury projection</span>
            <div className="rounded-lg bg-[#D9A441]/18 p-1.5"><TrendingUp size={14} className="text-[#C99A2E]" /></div>
          </div>
          <div className="dash-num mt-2 text-3xl font-extrabold text-[#0c3e48]">${fmtUsd(balance)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-[#D9A441]/15 px-2 py-0.5 text-[#9a6f15]">Ondo USDY</span>
            <span className="text-[#326273]/55">{rate.label} · withdrawals 1–3 business days</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#4F9C88]">
            <Sparkles size={11} /> +${yield30d.toFixed(2)} modeled yield (30d) · ~${dailyYield.toFixed(3)}/day
          </div>
        </div>
      </section>

      <section className="dash-surface overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
          <div className="border-b border-[#326273]/10 p-5 lg:border-b-0 lg:border-r">
            <span className="dash-kicker">Loop economics simulator</span>
            <h2 className="mt-2 text-xl font-extrabold text-[#0c3e48]">Sweep vs hold</h2>
            <p className="mt-2 max-w-xl text-xs leading-5 text-[#326273]/60">
              On a $5,000 payment, internal netting removes repeated payout work. The remainder is relocated to the point where funds eventually leave the Splash loop.
            </p>
            <label className="mt-6 block">
              <span className="flex items-center justify-between text-xs font-bold text-[#326273]">
                <span>Netting ratio</span>
                <span className="font-mono text-[#E39774]">{nettingRatio}%</span>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={nettingRatio}
                onChange={(event) => setNettingRatio(Number(event.target.value))}
                className="mt-3 h-2 w-full cursor-pointer accent-[#E39774]"
              />
              <span className="mt-2 flex justify-between text-[10px] font-bold uppercase tracking-wide text-[#326273]/35"><span>Full sweep</span><span>Full hold</span></span>
            </label>
          </div>
          <div className="bg-[#F6F0ED]/55 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[#5C9EAD]/20 bg-white p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#5C9EAD]">Fees deleted</div>
                <div className="dash-num mt-2 text-2xl font-extrabold text-[#0c3e48]">${feesDeleted.toFixed(2)}</div>
                <p className="mt-1 text-[11px] leading-4 text-[#326273]/55">Avoided while value stays netted inside the operating loop.</p>
              </div>
              <div className="rounded-2xl border border-[#E39774]/20 bg-white p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#E39774]">Fees relocated</div>
                <div className="dash-num mt-2 text-2xl font-extrabold text-[#0c3e48]">${feesRelocated.toFixed(2)}</div>
                <p className="mt-1 text-[11px] leading-4 text-[#326273]/55">Still paid when the remaining value reaches a local cash-out rail.</p>
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-full bg-[#E39774]/25">
              <div className="h-3 rounded-full bg-[#5C9EAD] transition-all" style={{ width: `${nettingRatio}%` }} />
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-white p-3 text-[11px] leading-4 text-[#326273]/60">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5C9EAD]" />
              Simulation only. Netting reduces repeated payout costs; it does not remove the cost of the final external payout.
            </div>
          </div>
        </div>
      </section>

      {/* Main layout */}
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">

        {/* ── Left ── */}
        <div className="space-y-5">

          {/* Yield chart */}
          <div className="dash-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#1F4452]">USDY daily yield</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#D9A441]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#9a6f15]">
                    variable
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#326273]/50">
                  {focusBar
                    ? <>Hovering <span className="font-semibold text-[#1F4452]">{focusBar.label}</span></>
                    : 'Accrues daily via USDY redemption price · floating, not fixed'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <div className="text-lg font-extrabold text-[#C99A2E]">
                    +${focusBar ? focusBar.amount.toFixed(3) : dailyYield.toFixed(3)}
                  </div>
                  <div className="text-[11px] text-[#326273]/50">{focusBar ? 'that day' : 'estimated today'}</div>
                </div>
                <div className="inline-flex rounded-md bg-[#F6F0ED] p-0.5">
                  {(['7d', '30d'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setChartRange(r); setHoveredBar(null); }}
                      className={cn('rounded px-2.5 py-1 text-[10px] font-bold transition-colors', chartRange === r ? 'bg-white text-[#1F4452] shadow-sm' : 'text-[#326273]/55 hover:text-[#326273]')}
                    >
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={cn('mt-4 flex items-end', chartRange === '7d' ? 'gap-2' : 'gap-1')} onMouseLeave={() => setHoveredBar(null)}>
              {bars.map((d, i) => {
                const range = maxBar - minBar || 1;
                const heightPct = 35 + ((d.amount - minBar) / range) * 65;
                const isMax = d.amount === maxBar;
                const isHover = hoveredBar === i;
                const barColor = BAR_COLORS[i % BAR_COLORS.length];
                return (
                  <div key={d.day} onMouseEnter={() => setHoveredBar(i)} onClick={() => setHoveredBar(i)} className="group relative flex flex-1 cursor-pointer flex-col items-center gap-1">
                    {isHover && (
                      <div className="pointer-events-none absolute -top-12 z-10 whitespace-nowrap rounded-lg bg-[#0c3e48] px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-xl">
                        <div className="text-white/60">{d.label}</div>
                        <div className="font-mono text-[#E0B05A]">+${d.amount.toFixed(3)}</div>
                        <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#0c3e48]" />
                      </div>
                    )}
                    {chartRange === '7d' && (
                      <span className="text-[10px] font-semibold transition-colors" style={{ color: barColor, opacity: isHover || isMax ? 1 : 0.85 }}>
                        ${d.amount.toFixed(2)}
                      </span>
                    )}
                    <div className="relative w-full overflow-hidden rounded-t-md bg-[#F6F0ED]" style={{ height: 64 }}>
                      <div className="absolute bottom-0 w-full rounded-t-md transition-all duration-200" style={{ height: `${heightPct}%`, backgroundColor: barColor, opacity: isHover ? 1 : isMax ? 0.95 : 0.72 }} />
                    </div>
                    <span className={cn('truncate transition-colors', chartRange === '7d' ? 'text-[10px]' : 'text-[8px]', isHover ? 'font-semibold text-[#1F4452]' : 'text-[#326273]/40')}>{d.day}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-[#D9A441]/20 bg-[#D9A441]/8 p-3">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#9a6f15]"><Sparkles size={10} /> Daily yield</div>
                <div className="dash-num mt-1 font-mono text-sm font-extrabold text-[#9a6f15]">+${dailyYield.toFixed(3)}</div>
              </div>
              <div className="rounded-lg bg-[#F6F0ED] p-3">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#326273]/55"><CalendarDays size={10} /> Period total</div>
                <div className="dash-num mt-1 font-mono text-sm font-extrabold text-[#1F4452]">+${totalRange.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[#F6F0ED] p-3">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#326273]/55"><TrendingUp size={10} /> Avg / day</div>
                <div className="dash-num mt-1 font-mono text-sm font-extrabold text-[#1F4452]">+${avgBar.toFixed(3)}</div>
              </div>
              <div className="rounded-lg bg-[#5C9EAD]/10 p-3">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#5C9EAD]"><PiggyBank size={10} /> Est. annual</div>
                <div className="dash-num mt-1 font-mono text-sm font-extrabold text-[#326273]">+${projAnnual.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Activity */}
          <div className="dash-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#326273]/8 px-4 py-3">
              <h2 className="text-sm font-bold text-[#1F4452]">Modeled Treasury Activity</h2>
              <span className="text-[11px] font-semibold text-[#326273]/45">USDC ↔ USDY · simulation ledger</span>
            </div>
            <div className="divide-y divide-[#326273]/5">
              {history.slice(0, 10).map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#F6F0ED]/50">
                  <HistIcon type={tx.type} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[#1F4452]">{tx.desc}</div>
                    <div className="text-[11px] text-[#326273]/45">{tx.date} · {tx.id}</div>
                  </div>
                  <div className="text-right">
                    <div className={cn('dash-num text-sm font-bold', tx.type === 'withdraw' ? 'text-[#5C9EAD]' : tx.type === 'yield' ? 'text-[#4F9C88]' : 'text-[#C99A2E]')}>{tx.amount}</div>
                    <div className={cn('text-[10px]', tx.status === 'confirmed' ? 'text-[#4F9C88]' : 'text-[#C99A2E]')}>{tx.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="dash-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#326273]/8 px-5 py-3">
              <div className="flex items-center gap-2">
                <Sprout size={14} className="text-[#4F9C88]" />
                <h2 className="text-sm font-bold text-[#1F4452]">How the treasury model works</h2>
              </div>
              <span className="rounded-full bg-[#D9A441]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#9a6f15]">T-bill yield</span>
            </div>
            <div className="relative grid gap-0 sm:grid-cols-4">
              <div className="pointer-events-none absolute left-5 right-5 top-[3.25rem] hidden h-px bg-gradient-to-r from-[#5C9EAD]/0 via-[#D9A441] to-[#E39774]/40 sm:block" />
              {[
                { step: '01', title: 'Prepare recommendation', desc: '0xWal models an allocation from Available USDC. Your business must approve it.', icon: CreditCard, accent: '#5C9EAD', bg: 'bg-[#5C9EAD]/10', tag: 'Human approval' },
                { step: '02', title: 'Ondo USDY (T-bills)', desc: 'USDY is backed by short-dated US Treasuries — real, off-chain yield.', icon: Landmark, accent: '#C99A2E', bg: 'bg-[#D9A441]/15', tag: 'T-bill backed' },
                { step: '03', title: 'Yield accrues', desc: 'USDY redemption price rises daily. Floating net rate — never fixed.', icon: Sprout, accent: '#4F9C88', bg: 'bg-[#6FB4A0]/18', tag: rate.label.replace(' · variable', '') },
                { step: '04', title: 'T+1–T+3 withdraw', desc: 'Request a withdrawal; USDY→USDC swaps and lands in Available in 1–3 business days.', icon: PiggyBank, accent: '#E39774', bg: 'bg-[#E39774]/10', tag: 'Notice required' },
              ].map(({ step, title, desc, icon: Icon, accent, bg, tag }, i, arr) => (
                <div key={step} className={cn('relative px-5 py-4', i < arr.length - 1 && 'border-[#326273]/8 sm:border-r')}>
                  <div className="flex items-center gap-3">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ring-2 ring-white', bg)} style={{ color: accent }}>
                      <Icon size={16} />
                    </div>
                    <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#326273]/35">{step}</span>
                  </div>
                  <div className="mt-3 text-xs font-extrabold text-[#1F4452]">{title}</div>
                  <div className="mt-1 text-[11px] leading-[1.125rem] text-[#326273]/65">{desc}</div>
                  <div className="mt-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ backgroundColor: `${accent}15`, color: accent }}>
                    <CheckCircle2 size={9} />{tag}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-[#326273]/8 bg-gradient-to-r from-[#D9A441]/8 via-[#6FB4A0]/5 to-[#5C9EAD]/5 px-5 py-3 text-[11px]">
              <div className="flex items-center gap-1.5 font-semibold text-[#1F4452]"><ShieldCheck size={12} className="text-[#4F9C88]" /> Funds segregated from operating</div>
              <span className="text-[#326273]/30">•</span>
              <div className="flex items-center gap-1.5 text-[#326273]/65"><Lock size={11} className="text-[#5C9EAD]" /> Daily reconciliation, Walrus-anchored</div>
            </div>
          </div>
        </div>

        {/* ── Right ── */}
        <aside className="space-y-4">

          {/* Move funds */}
          <div className="dash-surface p-4">
            <div className="flex rounded-lg bg-[#F6F0ED] p-1">
              {([['toTreasury', '→ To Treasury'], ['toAvailable', '← To Available']] as const).map(([t, lbl]) => (
                <button
                  key={t}
                  type="button"
                  disabled={!executionEnabled}
                  onClick={() => { setTab(t); setAmount(''); }}
                  className={cn('flex-1 rounded-md py-1.5 text-xs font-bold transition-colors', tab === t ? 'bg-white text-[#1F4452] shadow-sm' : 'text-[#326273]/50 hover:text-[#326273]')}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#326273]/50">Amount (USD)</label>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#326273]/15 bg-[#F6F0ED] px-3 py-2.5 transition-all focus-within:border-[#D9A441] focus-within:ring-2 focus-within:ring-[#D9A441]/15">
                  <span className="text-sm font-semibold text-[#326273]/50">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    disabled={!executionEnabled}
                    onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d{0,2}$/.test(v)) setAmount(v); }}
                    placeholder="0.00"
                    className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[#1F4452] placeholder-[#326273]/30 outline-none"
                  />
                  <button type="button" disabled={!executionEnabled} onClick={() => setAmount(String(Math.floor(sourceBalance)))} className="shrink-0 rounded-md bg-[#326273]/10 px-2 py-0.5 text-[10px] font-bold text-[#326273]/60 transition-colors hover:bg-[#326273]/20 hover:text-[#326273] disabled:cursor-not-allowed disabled:opacity-40">MAX</button>
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg bg-[#F6F0ED] p-3 text-[11px]">
                <div className="flex justify-between"><span className="text-[#326273]/55">From {tab === 'toTreasury' ? 'Available (USDC)' : 'Smart Treasury (USDY)'}</span><span className="dash-num font-semibold text-[#1F4452]">${fmtUsd(sourceBalance)}</span></div>
                <div className="flex justify-between"><span className="text-[#326273]/55">Rate</span><span className="font-semibold text-[#9a6f15]">{tab === 'toTreasury' ? rate.label : '0% · instant'}</span></div>
                {previewSource !== null && (
                  <div className="flex justify-between border-t border-[#326273]/10 pt-1.5"><span className="font-semibold text-[#326273]/70">After</span><span className="dash-num font-bold text-[#1F4452]">${fmtUsd(previewSource)}</span></div>
                )}
                {tab === 'toAvailable' && validAmount && (
                  <div className="flex items-center gap-1.5 text-[10px] text-[#C97A56]"><Clock size={10} /> Lands in Available in 1–3 business days</div>
                )}
              </div>

              <button
                type="submit"
                disabled={!executionEnabled || loading || !validAmount}
                className={cn(
                  'w-full rounded-lg py-2.5 text-sm font-bold text-white transition-all disabled:opacity-50',
                  tab === 'toTreasury' ? 'bg-[#C99A2E] hover:bg-[#b3881f]' : 'bg-[#5C9EAD] hover:bg-[#4a8a99]',
                )}
              >
                {!executionEnabled ? 'Execution disabled' : loading ? 'Processing…' : tab === 'toTreasury' ? '→ Move to Smart Treasury' : '← Request withdrawal'}
              </button>
            </form>
          </div>

          {/* Pending withdrawals */}
          {notices.length > 0 && (
            <div className="dash-block p-4">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-[#C97A56]" />
                <h2 className="text-sm font-bold text-[#1F4452]">Pending withdrawals</h2>
              </div>
              <div className="mt-3 space-y-2">
                {notices.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#E39774]/10 px-3 py-2 text-[11px]">
                    <span className="dash-num font-bold text-[#1F4452]">${fmtUsd(n.amount)}</span>
                    <span className="text-[#C97A56]">by {new Date(n.availableAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk & compliance */}
          <div className="dash-block p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-[#5C9EAD]" />
              <h2 className="text-sm font-bold text-[#1F4452]">Risk &amp; Compliance</h2>
            </div>
            <div className="mt-3 space-y-2">
              {RISK_ITEMS.map((r) => (
                <div key={r.label} className="flex items-start gap-2 rounded-lg bg-[#F6F0ED] px-3 py-2">
                  <r.icon size={13} className="mt-0.5 shrink-0 text-[#5C9EAD]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-[#326273]/50">{r.label}</div>
                    <div className="text-xs font-semibold text-[#1F4452]">{r.value}</div>
                  </div>
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[#4F9C88]" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
              <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[11px] leading-4 text-amber-700">
                Yield is variable and not guaranteed. USDY is T-bill backed; rates move with US Treasury yields.
              </p>
            </div>
          </div>

          {/* Links */}
          <div className="space-y-2">
            {[
              { label: 'Ondo USDY overview', icon: Info, href: 'https://ondo.finance/usdy' },
              { label: 'View on Sui Explorer', icon: Landmark, href: 'https://suiscan.xyz/testnet' },
            ].map(({ label, icon: Icon, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-between rounded-lg border border-[#326273]/10 bg-white px-3 py-2.5 text-xs font-semibold text-[#326273] transition-colors hover:border-[#5C9EAD]/40 hover:text-[#5C9EAD]">
                <div className="flex items-center gap-2"><Icon size={13} />{label}</div>
                <ChevronRight size={13} className="text-[#326273]/30" />
              </a>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
