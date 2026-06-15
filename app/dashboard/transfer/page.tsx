'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import SettlementEngineFlow from '@/components/dashboard/SettlementEngineFlow';

import StepBeneficiary from '@/components/transfer/StepBeneficiary';
import StepQuote from '@/components/transfer/StepQuote';
import StepReceipt from '@/components/transfer/StepReceipt';
import StepStatus from '@/components/transfer/StepStatus';
import StepDelivery from '@/components/transfer/StepDelivery';
import type { RecipientTier } from '@/lib/server/operations';

// Target-currency display metadata for the settlement-flow corridor node.
const CURRENCY_META: Record<string, { flag: string; country: string }> = {
  PHP: { flag: '🇵🇭', country: 'Philippines' },
  MYR: { flag: '🇲🇾', country: 'Malaysia' },
  IDR: { flag: '🇮🇩', country: 'Indonesia' },
  SGD: { flag: '🇸🇬', country: 'Singapore' },
  VND: { flag: '🇻🇳', country: 'Vietnam' },
  THB: { flag: '🇹🇭', country: 'Thailand' },
  EUR: { flag: '🇪🇺', country: 'Eurozone' },
  GBP: { flag: '🇬🇧', country: 'United Kingdom' },
};

export type TransferState = {
  step: 1 | 2 | 3 | 4 | 5;
  invoiceId?: string;
  recipient: {
    name: string;
    country: 'MY' | 'PH' | 'ID' | 'SG' | 'VN' | 'TH' | 'EU' | 'GB';
    rail: 'bank';
    bank?: { swift: string; account: string };
  };
  amount: { value: string; sourceCurrency: 'USD'; targetCurrency: 'MYR' | 'PHP' | 'IDR' | 'SGD' | 'VND' | 'THB' | 'EUR' | 'GBP' };
  quote?: { fxRate: number; netReceived: string; fee: string };
  txDigest?: string;
  txStatus?: 'pending' | 'success' | 'failed';
  transferIntentId?: string;
  receiptObjectId?: string;
  deliveryTier: RecipientTier;
  rateHold?: {
    id: string;
    corridorCurrency: string;
    rate: string;
    feeBps: number;
    holdUntil: string;
    state: 'ACTIVE' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED';
  };
};

const initial: TransferState = {
  step: 1,
  recipient: { name: '', country: 'PH', rail: 'bank' },
  amount: { value: '', sourceCurrency: 'USD', targetCurrency: 'PHP' },
  deliveryTier: 'PAYOUT_ONLY',
};

const stepLabels = ['Beneficiary', 'Delivery', 'Quote & Send', 'Status', 'Receipt'] as const;

const sidePanels = [
  {
    icon: ShieldCheck,
    title: 'No stored credentials',
    body: 'Splash never holds bank login details. Deposits are confirmed through Stripe Checkout or Airwallex wire.',
  },
  {
    icon: Timer,
    title: 'Quote valid 30s',
    body: 'Live FX is locked at authorization. We re-quote if the rate moves before you sign.',
  },
  {
    icon: Sparkles,
    title: 'Sui finality',
    body: 'Cross-border legs settle on Sui in ~400ms with on-chain receipts you can audit.',
  },
];

export default function TransferPage() {
  const [state, setState] = useState<TransferState>(initial);
  const set = useCallback((patch: Partial<TransferState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);
  const go = useCallback((step: TransferState['step']) => {
    set({ step });
  }, [set]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invoiceId = params.get('invoiceId');
    const holdId = params.get('holdId');
    if (invoiceId) {
      void fetch(`/api/invoices/${invoiceId}`).then((response) => response.json()).then((invoice: { payerOrgName?: string; amountUsd?: string; targetCurrency?: TransferState['amount']['targetCurrency']; id?: string }) => {
        if (!invoice.id) return;
        setState((current) => ({
          ...current,
          step: 2,
          invoiceId: invoice.id,
          recipient: { ...current.recipient, name: invoice.payerOrgName ?? current.recipient.name, country: 'PH' },
          amount: { ...current.amount, value: invoice.amountUsd ?? current.amount.value, targetCurrency: invoice.targetCurrency ?? current.amount.targetCurrency },
          deliveryTier: invoice.targetCurrency === 'PHP' ? 'SWEEP_ACCOUNT' : 'PAYOUT_ONLY',
        }));
      });
    }
    if (holdId) {
      void fetch(`/api/rate-holds?id=${encodeURIComponent(holdId)}`).then((response) => response.json()).then((hold: TransferState['rateHold']) => {
        if (!hold?.id || hold.state !== 'ACTIVE') return;
        setState((current) => ({
          ...current,
          rateHold: hold,
          amount: { ...current.amount, targetCurrency: hold.corridorCurrency as TransferState['amount']['targetCurrency'] },
        }));
      });
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="dash-kicker">Payment intent</span>
          <h1 className="dash-title mt-2">Send a payout</h1>
          <p className="mt-1 text-xs font-medium text-[#326273]/60">
            Capture a beneficiary, lock the USD quote, confirm deposit, then download the on-chain receipt.
          </p>
        </div>
        <div className="rounded-[11px] border border-[#326273]/15 bg-white/70 px-3 py-2 text-xs font-bold text-[#326273]">
          Step {state.step} of 5 · {stepLabels[state.step - 1]}
        </div>
      </header>

      {/* Signature: this payout's settlement journey */}
      <SettlementEngineFlow
        variant="settlement"
        className="dash-reveal"
        corridors={[{
          flag: CURRENCY_META[state.amount.targetCurrency]?.flag,
          label: state.amount.targetCurrency,
          sublabel: CURRENCY_META[state.amount.targetCurrency]?.country ?? state.recipient.country,
        }]}
        captions={['400ms Sui finality', 'Quote locked at signing', 'On-chain receipt']}
      />

      <Stepper current={state.step} />

      <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="dash-surface p-6 md:p-8">
          {state.step === 1 && <StepBeneficiary state={state} set={set} next={() => go(2)} />}
          {state.step === 2 && <StepDelivery state={state} set={set} prev={() => go(1)} next={() => go(3)} />}
          {state.step === 3 && <StepQuote state={state} set={set} prev={() => go(2)} next={() => go(4)} />}
          {state.step === 4 && <StepStatus state={state} set={set} next={() => go(5)} />}
          {state.step === 5 && <StepReceipt state={state} reset={() => setState(initial)} />}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[#0c3e48] bg-[#0c3e48] p-5 text-white shadow-[6px_7px_0_rgba(12,62,72,0.18)]">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">Live transfer</div>
            <div className="mt-2 text-lg font-extrabold">
              {state.amount.value ? `$${state.amount.value}` : 'Awaiting amount'}
            </div>
            <div className="mt-1 text-xs text-white/65">
              {state.recipient.name ? `To ${state.recipient.name}` : 'No beneficiary selected'} · USD → {state.recipient.country}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <Pill label="Source" value="USD" />
              <Pill label="Target" value={state.amount.targetCurrency} />
            </div>
          </div>

          {sidePanels.map(({ icon: Icon, title, body }) => (
            <div key={title} className="dash-block p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5C9EAD]/10 text-[#5C9EAD]">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#326273]">{title}</div>
                  <p className="mt-1 text-xs leading-5 text-[#326273]/65">{body}</p>
                </div>
              </div>
            </div>
          ))}
        </aside>
      </section>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/55">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="dash-surface grid grid-cols-5 gap-0 overflow-hidden">
      {stepLabels.map((label, index) => {
        const step = index + 1;
        const active = step === current;
        const done = step < current;
        const last = step === stepLabels.length;

        return (
          <li
            key={label}
            className={`relative flex flex-col items-center justify-center gap-1.5 px-1.5 py-3 text-center transition-colors sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-4 sm:text-left ${active ? 'bg-[#0c3e48]/[0.06]' : 'bg-transparent'} ${last ? '' : 'border-r border-[#326273]/10'}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all sm:h-8 sm:w-8 sm:text-xs ${done
                ? 'bg-[#5C9EAD] text-white shadow-md shadow-[#5C9EAD]/30'
                : active
                ? 'bg-[#E39774] text-white shadow-md shadow-[#E39774]/30'
                : 'bg-[#326273]/8 text-[#326273]/55'}`}
            >
              {done ? <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : step}
            </span>
            <div className="min-w-0 sm:flex-1">
              <div className={`hidden text-[10px] font-bold uppercase tracking-[0.18em] sm:block ${active ? 'text-[#E39774]' : done ? 'text-[#5C9EAD]' : 'text-[#326273]/45'}`}>
                Step {step}
              </div>
              <div className={`truncate text-[10px] font-bold leading-tight sm:text-sm ${active || done ? 'text-[#326273]' : 'text-[#326273]/55'}`}>
                {label}
              </div>
            </div>
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#E39774]" aria-hidden="true" />
            )}
            {done && (
              <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#5C9EAD]" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
