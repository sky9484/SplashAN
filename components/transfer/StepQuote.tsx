'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, Clock3, CreditCard, Info, Loader2, ShieldCheck, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import HoverPopup from '@/components/HoverPopup';
import type { TransferState } from '@/app/dashboard/transfer/page';

const BASE_RATES: Record<TransferState['amount']['targetCurrency'], number> = { MYR: 4.71, PHP: 56.42, IDR: 16284, SGD: 1.345, VND: 25385, THB: 35.82, EUR: 0.924, GBP: 0.789 };

// Funding is bank-rails only — card (Stripe Checkout) is disabled to protect
// pricing (paying ~2.9% to collect funds we move for ~1.3% destroys the margin).
type DepositMethod = { id: string; label: string; type: 'bank' | 'card'; note: string };
const depositMethods: DepositMethod[] = [
  { id: 'Airwallex Wire',          label: 'Airwallex Wire',  type: 'bank', note: 'Bank wire · recommended' },
  { id: 'Stripe ACH',              label: 'Stripe ACH',      type: 'bank', note: 'US bank debit · recommended' },
  { id: 'Airwallex FPX (MY users)', label: 'Airwallex FPX',  type: 'bank', note: 'Malaysia online banking' },
  { id: 'Stripe Checkout',         label: 'Stripe Checkout', type: 'card', note: 'Card funding disabled — use a bank rail' },
];

export default function StepQuote({ state, set, prev, next }: { state: TransferState; set: (patch: Partial<TransferState>) => void; prev: () => void; next: () => void }) {
  const [loading, setLoading] = useState(true);
  const [agree, setAgree] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [selectedDepositMethod, setSelectedDepositMethod] = useState(depositMethods[0].id);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(18);
  const [liveRate, setLiveRate] = useState(BASE_RATES[state.amount.targetCurrency]);
  const [rateDirection, setRateDirection] = useState<'up' | 'down' | 'neutral'>('neutral');
  const [holdBusy, setHoldBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchQuote() {
      const source = Number.parseFloat(state.amount.value || '0');

      if (!Number.isFinite(source) || source <= 0) {
        set({ quote: { fxRate: 0, fee: '0.00', netReceived: '0.00' } });
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: source,
            targetCurrency: state.amount.targetCurrency,
            recipientId: state.recipient.bank?.account,
          }),
        });

        if (!response.ok) throw new Error('Quote unavailable');

        const body = (await response.json()) as {
          exchangeRate: string;
          platformFee: number;
          toAmount: number;
        };

        if (cancelled) return;

        const quotedFx = Number.parseFloat(body.exchangeRate);
        const heldFx = state.rateHold?.state === 'ACTIVE' && state.rateHold.corridorCurrency === state.amount.targetCurrency
          ? Number.parseFloat(state.rateHold.rate)
          : null;
        const fx = heldFx ?? quotedFx;
        const netReceived = heldFx && quotedFx > 0 ? (body.toAmount / quotedFx) * heldFx : body.toAmount;
        setLiveRate(fx);
        set({ quote: { fxRate: fx, fee: (body.platformFee / 100).toFixed(2), netReceived: netReceived.toFixed(2) } });
      } catch {
        if (cancelled) return;

        const fee = source * 0.014 + 4.5;
        const net = source - fee;
        const fx = BASE_RATES[state.amount.targetCurrency];
        set({ quote: { fxRate: fx, fee: fee.toFixed(2), netReceived: (net * fx).toFixed(2) } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetchQuote();
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state.amount.targetCurrency, state.amount.value, state.rateHold?.corridorCurrency, state.rateHold?.rate, state.rateHold?.state, state.recipient.bank?.account, set]);

  useEffect(() => {
    if (state.rateHold?.state === 'ACTIVE') return;
    const interval = window.setInterval(() => {
      const change = (Math.random() - 0.5) * 0.002;
      setRateDirection(change > 0 ? 'up' : change < 0 ? 'down' : 'neutral');
      setLiveRate((current) => Math.max(current + change, 0));
    }, 5000);

    return () => window.clearInterval(interval);
  }, [state.rateHold?.state]);

  const createTransferIntent = useCallback(async () => {
    try {
      const response = await fetch('/api/transfers/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state, paymentRail: selectedDepositMethod.startsWith('Airwallex') ? 'AIRWALLEX_WIRE' : 'STRIPE_CHECKOUT', selectedDepositMethod }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? 'Send request failed');
      }

      const body = (await response.json()) as { transferIntentId: string };
      set({ transferIntentId: body.transferIntentId, txStatus: 'pending' });
      toast.success('USD deposit confirmed');
      setDepositOpen(false);
      setIsSending(false);
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Send request failed';
      setIsSending(false);
      toast.error(message);
    }
  }, [next, selectedDepositMethod, set, state]);

  useEffect(() => {
    if (!isSending) return;

    const progressTimer = window.setInterval(() => {
      setProgress((value) => Math.min(value + 18, 100));
    }, 420);

    const authorizationTimer = window.setTimeout(() => {
      void createTransferIntent();
    }, 2600);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(authorizationTimer);
    };
  }, [isSending, createTransferIntent]);

  function startDeposit() {
    if (!agree || !state.quote) return;
    setProgress(18);
    setDepositOpen(true);
  }

  function authorizeWithBank() {
    setProgress(18);
    setIsSending(true);
  }

  async function holdRate() {
    setHoldBusy(true);
    try {
      const response = await fetch('/api/rate-holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corridorCurrency: state.amount.targetCurrency, rate: liveRate }),
      });
      if (!response.ok) throw new Error('Rate hold could not be created');
      const hold = (await response.json()) as NonNullable<TransferState['rateHold']>;
      set({ rateHold: hold });
      toast.success('Rate hold active for 48 hours');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rate hold could not be created');
    } finally {
      setHoldBusy(false);
    }
  }

  if (loading || !state.quote) {
    return <div className="py-10 text-center text-[#326273]/60">Fetching live FX & fee quote…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[#326273]">Quote, review & send</h2>
        <p className="mt-1 text-sm text-[#326273]/60">Confirm a USD deposit through Stripe or Airwallex, then Splash settles the local-currency payout on Sui.</p>
      </div>
      <div className="space-y-3 rounded-xl bg-[#F6F0ED] p-5 text-sm">
        <HoverPopup title="Recipient" content="The person or business receiving this transfer. Verify the name matches your records.">
          <Row label="Recipient" value={state.recipient.name} />
        </HoverPopup>
        <HoverPopup title="Country" content="Destination country for this transfer. Supported corridors include SEA plus EUR and GBP in Phase 1.">
          <Row label="Country" value={state.recipient.country} />
        </HoverPopup>
        <HoverPopup title="Rail" content="Bank Account: Direct bank transfer to recipient account.">
          <Row label="Rail" value="Bank Account" />
        </HoverPopup>
        <HoverPopup title="Target reference" content="Recipient bank account number.">
          <Row label="Target" value={state.recipient.bank?.account ?? '—'} mono />
        </HoverPopup>
        <hr className="border-[#326273]/10" />
        <HoverPopup title="Send amount" content="Amount you are sending in USD. Recipients receive local currency after FX conversion.">
          <Row label="You send" value={`$${state.amount.value}`} />
        </HoverPopup>
        <HoverPopup title="Splash fees" content="1.4% transaction fee + $4.50 fixed fee per transfer.">
          <Row label="Splash fees" value={state.deliveryTier === 'STORED_BALANCE' ? '$0.00 transfer fee' : `$${state.quote.fee}`} />
        </HoverPopup>
        <HoverPopup title="Live FX rate" content="Real-time exchange rate updated every 5 seconds. Rate may fluctuate until authorization.">
          <div className="flex justify-between gap-4 items-center">
            <span className="text-[#326273]/60">FX rate</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium text-[#326273]">1 USD → {liveRate.toLocaleString(undefined, { maximumFractionDigits: state.amount.targetCurrency === 'IDR' || state.amount.targetCurrency === 'VND' ? 0 : 3 })} {state.amount.targetCurrency}</span>
              {rateDirection !== 'neutral' && (
                <TrendingUp className={`h-4 w-4 ${rateDirection === 'up' ? 'text-[#5C9EAD]' : 'text-[#E39774] rotate-180'}`} />
              )}
            </div>
          </div>
        </HoverPopup>
        <hr className="border-[#326273]/10" />
        <HoverPopup title="Recipient receives" content="Final amount the recipient will get after FX conversion and fees.">
          <Row label="Recipient receives" value={`${state.quote.netReceived} ${state.amount.targetCurrency}`} bold />
        </HoverPopup>
        <div className="mt-2 flex items-center gap-2 text-xs text-[#326273]/60">
          <Info className="h-3 w-3" />
          {state.rateHold?.state === 'ACTIVE'
            ? `Rate hold active until ${new Date(state.rateHold.holdUntil).toLocaleString()}. You still authorize before value moves.`
            : 'Quote valid for 30 seconds. AI can suggest timing, but you always sign before value moves.'}
        </div>
        <Row label="Delivery" value={state.deliveryTier === 'PAYOUT_ONLY' ? 'Bank payout' : state.deliveryTier === 'SWEEP_ACCOUNT' ? 'Receive account + auto-sweep' : 'Splash balance'} bold />
      </div>
      <button
        type="button"
        disabled={holdBusy || state.rateHold?.state === 'ACTIVE'}
        onClick={() => void holdRate()}
        className="flex w-full items-center justify-between rounded-xl border border-[#5C9EAD]/30 bg-white px-4 py-3 text-left font-bold text-[#326273] transition hover:border-[#5C9EAD] hover:bg-[#5C9EAD]/10 disabled:cursor-default disabled:opacity-70"
      >
        <span className="flex items-center gap-3">
          <Clock3 className="h-5 w-5 text-[#5C9EAD]" />
          {state.rateHold?.state === 'ACTIVE' ? 'Rate hold active' : 'Hold this rate 48h'}
        </span>
        <span className="font-mono text-xs text-[#326273]/55">{liveRate.toLocaleString()}</span>
      </button>
      <div className="rounded-xl border border-[#5C9EAD]/20 bg-[#5C9EAD]/10 p-4 text-sm text-[#326273]/75">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-[#5C9EAD]" />
          <span>Funding is bank-rails only — ACH, wire, or FPX (Airwallex / Stripe ACH). Card funding is disabled to protect transfer pricing. No bank credentials are stored.</span>
        </div>
      </div>
      <label className="flex items-start gap-3 text-sm text-[#326273]/80">
        <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} className="mt-1 h-4 w-4 cursor-pointer rounded border-[#326273]/30 bg-white accent-[#5C9EAD] checked:bg-[#5C9EAD] checked:border-[#5C9EAD] focus:ring-2 focus:ring-[#5C9EAD]/50" />
        I confirm the recipient details are correct and I want to continue with USD deposit confirmation.
      </label>
      <div className="flex gap-3">
        <button onClick={prev} className="flex-1 rounded-lg border border-[#326273]/20 py-3 font-semibold text-[#326273]">← Back</button>
        <button disabled={!agree} onClick={startDeposit} className="flex-1 rounded-lg bg-[#E39774] py-3 font-bold text-white hover:bg-[#cd825f] disabled:opacity-50">Send</button>
      </div>
      {depositOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#326273]/50 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 text-[#326273] shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full bg-[#E39774]/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#E39774]">USD deposit</div>
                <h3 className="text-2xl font-extrabold">Choose deposit method</h3>
                <p className="mt-1 text-sm text-[#326273]/60">Stripe and Airwallex confirm USD funding before the Sui settlement leg starts.</p>
              </div>
              <button type="button" onClick={() => !isSending && setDepositOpen(false)} className="rounded-full px-3 py-1 text-sm font-bold text-[#326273]/50 hover:bg-[#F6F0ED]">×</button>
            </div>
            <div className="mt-5 rounded-2xl bg-[#326273] p-5 text-white">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/65">Transfer amount</span>
                <span className="text-2xl font-bold">${state.amount.value}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-white/65">Recipient receives</span>
                <span className="font-semibold">{state.quote.netReceived} {state.amount.targetCurrency}</span>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {depositMethods.map((m) => {
                const disabled = isSending || m.type === 'card';
                const selected = selectedDepositMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelectedDepositMethod(m.id)}
                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-none ${selected ? 'border-[#5C9EAD] bg-[#5C9EAD]/10 shadow-lg shadow-[#5C9EAD]/10' : 'border-[#326273]/10 bg-white'}`}
                  >
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F6F0ED] text-[#326273]">
                      {m.type === 'card' ? <CreditCard className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                    </div>
                    <p className="font-semibold">{m.label}{m.type === 'bank' && <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-[#5C9EAD]">bank</span>}</p>
                    <p className={`mt-1 text-xs ${m.type === 'card' ? 'font-semibold text-[#E39774]' : 'text-[#326273]/60'}`}>{m.note}</p>
                  </button>
                );
              })}
            </div>
            {isSending && (
              <div className="mt-5 space-y-3">
                <div className="h-3 overflow-hidden rounded-full bg-[#F6F0ED]">
                  <div className="h-full rounded-full bg-[#5C9EAD] transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#326273]/70">
                  {progress >= 100 ? <CheckCircle2 className="h-4 w-4 text-[#5C9EAD]" /> : <Loader2 className="h-4 w-4 animate-spin text-[#E39774]" />}
                  Confirming {selectedDepositMethod}…
                </div>
              </div>
            )}
            <button type="button" disabled={isSending} onClick={authorizeWithBank} className="mt-5 w-full rounded-xl bg-[#E39774] py-3 font-bold text-white hover:bg-[#cd825f] disabled:opacity-50">
              {isSending ? 'Confirming deposit…' : `Continue with ${selectedDepositMethod}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#326273]/60">{label}</span>
      <span className={`text-right ${bold ? 'text-base font-bold text-[#326273]' : 'font-medium text-[#326273]'} ${mono ? 'break-all font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}
