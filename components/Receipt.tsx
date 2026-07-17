"use client";

import { forwardRef } from "react";
import { ShieldCheck, Check, ArrowRight, Landmark, Hash, Clock } from "lucide-react";

export type ReceiptProps = {
  txDigest: string;
  sender: string;
  recipient: string;
  amount: string;
  currency: string;
  fee: string;
  feeTier?: 'STANDARD' | 'DISCOUNT';
  fundingSource?: string;
  timestamp: string;
  reference?: string;
  explorerUrl?: string | null;
  /** Optional enrichments — the receipt degrades gracefully without them. */
  recipientName?: string;
  network?: string;
  status?: 'Settled' | 'Pending';
  targetCurrency?: string;
  fxRate?: string | number;
};

const INK = '#1F4452';
const SLATE = '#326273';
const TEAL = '#5C9EAD';
const CORAL = '#E39774';
const OK = '#2E7D6B';
const LINE = '#E5DCD6';
const MUTE = '#6B7C85';

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function money(value: string | number | undefined): string {
  const n = toNumber(value);
  if (n === null) return String(value ?? '—');
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTimestamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  });
}

const SettlementReceipt = forwardRef<HTMLDivElement, ReceiptProps>(function SettlementReceipt(props, ref) {
  const {
    amount, fee, currency, network = 'Sui Testnet', status = 'Settled',
    feeTier = 'STANDARD', recipientName, txDigest, explorerUrl, fxRate, targetCurrency,
  } = props;

  const amountNum = toNumber(amount);
  const feeNum = toNumber(fee) ?? 0;
  const net = amountNum !== null ? amountNum - feeNum : null;
  const feePct = amountNum && amountNum > 0 ? (feeNum / amountNum) * 100 : null;
  const settled = status === 'Settled';
  const isPendingDigest = !txDigest || txDigest === 'Pending';

  return (
    <div
      ref={ref}
      className="relative mx-auto max-w-xl overflow-hidden rounded-2xl bg-white font-sans text-[#1F4452] shadow-[0_12px_32px_rgb(31_68_82_/.12)] [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {/* Brand accent bar */}
      <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${SLATE} 0%, ${TEAL} 55%, ${CORAL} 100%)` }} />

      <div className="px-8 pt-7 pb-6 sm:px-10">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-[-0.01em]">
              SPLASH<span style={{ color: TEAL }}>.</span>
            </div>
            <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em]" style={{ color: MUTE }}>
              Settlement Receipt
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold"
            style={settled ? { color: OK, background: '#E4F1ED' } : { color: MUTE, background: '#EDEFF0' }}
          >
            {settled ? <ShieldCheck className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
            {settled ? 'Settled on-chain' : 'Pending'}
          </span>
        </header>

        {/* Hero amount */}
        <section className="mt-7">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: MUTE }}>
            Amount settled
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-[-0.02em]">{money(amount)}</span>
            <span className="text-lg font-semibold" style={{ color: SLATE }}>{currency}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl px-4 py-3" style={{ background: '#FBF7F5', border: `1px solid ${LINE}` }}>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: MUTE }}>Delivered to recipient</div>
              <div className="mt-0.5 text-base font-semibold">{net !== null ? money(net) : '—'} <span className="text-[13px] font-medium" style={{ color: MUTE }}>{currency}</span></div>
            </div>
            <div className="rounded-xl px-4 py-3" style={{ background: '#FBF7F5', border: `1px solid ${LINE}` }}>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: MUTE }}>
                Network fee{feeTier === 'DISCOUNT' ? ' · discount' : ''}
              </div>
              <div className="mt-0.5 text-base font-semibold">
                {money(fee)} <span className="text-[13px] font-medium" style={{ color: MUTE }}>{currency}</span>
                {feePct !== null && <span className="ml-1 text-[13px] font-medium" style={{ color: TEAL }}>({feePct.toFixed(2)}%)</span>}
              </div>
            </div>
          </div>
        </section>

        {/* Perforation */}
        <div className="relative my-6" aria-hidden>
          <div className="border-t border-dashed" style={{ borderColor: LINE }} />
          <span className="absolute -left-10 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-[#F6F0ED]" />
          <span className="absolute -right-10 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-[#F6F0ED]" />
        </div>

        {/* Detail grid */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <Field label="From"><span className="font-medium">{props.sender}</span></Field>
          <Field label="To">
            <span className="font-medium">{recipientName ?? props.recipient}</span>
            {recipientName && recipientName !== props.recipient && (
              <span className="mt-0.5 block font-mono text-[13px]" style={{ color: MUTE }}>{props.recipient}</span>
            )}
          </Field>
          <Field label="Payment source">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Landmark className="h-3.5 w-3.5" style={{ color: TEAL }} />
              {props.fundingSource ?? 'Bank USD'}
            </span>
          </Field>
          <Field label="Settlement network"><span className="font-medium">{network}</span></Field>
          {fxRate !== undefined && (
            <Field label={`FX rate${targetCurrency ? ` (${currency}→${targetCurrency})` : ''}`}>
              <span className="font-medium">{money(fxRate)}</span>
            </Field>
          )}
          <Field label="Reference"><span className="font-mono text-[13px] font-medium">{props.reference ?? '—'}</span></Field>
        </dl>

        {/* Timeline */}
        <div className="mt-6 flex items-center justify-between rounded-xl px-4 py-3" style={{ background: '#E7EEF1' }}>
          <TimelineStep label="Initiated" done />
          <TimelineArrow />
          <TimelineStep label="Settled · ~400ms" done={settled} />
          <TimelineArrow />
          <TimelineStep label="Delivered" done={settled} />
        </div>

        {/* On-chain proof */}
        <section className="mt-5 rounded-xl p-4" style={{ border: `1px solid ${LINE}`, background: '#FFFFFF' }}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: SLATE }}>
            <ShieldCheck className="h-4 w-4" style={{ color: OK }} />
            On-chain proof
          </div>
          <div className="mt-2 flex items-start gap-2">
            <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: MUTE }} />
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: MUTE }}>Transaction digest</div>
              <div className="break-all font-mono text-[13px] font-medium" style={{ color: INK }}>
                {isPendingDigest ? 'Pending finality' : txDigest}
              </div>
            </div>
          </div>
          {explorerUrl && (
            <div className="mt-2 break-all font-mono text-[13px]" style={{ color: TEAL }}>{explorerUrl}</div>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-5 flex items-center justify-between gap-4 text-[13px]" style={{ color: MUTE }}>
          <span>Issued {formatTimestamp(props.timestamp)}</span>
          <span className="text-right">Immutable record anchored on {network}. Verify the digest independently at any time.</span>
        </footer>
      </div>
    </div>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: MUTE }}>{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function TimelineStep({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full"
        style={done ? { background: OK, color: '#FFFFFF' } : { background: '#EDEFF0', color: MUTE }}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Clock className="h-3 w-3" />}
      </span>
      <span className="text-[13px] font-medium leading-tight" style={{ color: done ? SLATE : MUTE }}>{label}</span>
    </div>
  );
}

function TimelineArrow() {
  return <ArrowRight className="mx-1 h-3.5 w-3.5 shrink-0" style={{ color: TEAL }} aria-hidden />;
}

export default SettlementReceipt;
