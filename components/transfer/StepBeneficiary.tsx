'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Building2, Check, Loader2, Search, Users } from 'lucide-react';

import type { TransferState } from '@/app/dashboard/transfer/page';
import type { RecipientRecord } from '@/lib/server/operations';

type TransferPatch = (patch: Partial<TransferState>) => void;
type RecipientCountry = TransferState['recipient']['country'];
type TargetCurrency = TransferState['amount']['targetCurrency'];

const RATES: Record<TargetCurrency, number> = {
  MYR: 4.71,
  PHP: 56.42,
  IDR: 16284,
  SGD: 1.345,
  VND: 25385,
  THB: 35.82,
  EUR: 0.924,
  GBP: 0.789,
};

const COUNTRY_TO_CURRENCY: Record<RecipientCountry, TargetCurrency> = {
  MY: 'MYR',
  PH: 'PHP',
  ID: 'IDR',
  SG: 'SGD',
  VN: 'VND',
  TH: 'THB',
  EU: 'EUR',
  GB: 'GBP',
};

const SUPPORTED_COUNTRIES = new Set<RecipientCountry>(['MY', 'PH', 'ID', 'SG', 'VN', 'TH', 'EU', 'GB']);

export default function StepBeneficiary({ state, set, next }: { state: TransferState; set: TransferPatch; next: () => void }) {
  const recipient = state.recipient;
  const amount = state.amount;
  const [savedRecipients, setSavedRecipients] = useState<RecipientRecord[]>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const valid =
    recipient.name.length > 1 &&
    Boolean(recipient.bank?.account) &&
    Number.parseFloat(amount.value || '0') > 0;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/recipients', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Saved recipients are unavailable');
        return response.json() as Promise<RecipientRecord[]>;
      })
      .then((records) => {
        setSavedRecipients(records);
        setRecipientError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRecipientError(error instanceof Error ? error.message : 'Saved recipients are unavailable');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRecipients(false);
      });
    return () => controller.abort();
  }, []);

  const filteredRecipients = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();
    const records = savedRecipients.filter((item) => item.account);
    if (!query) return records.slice(0, 5);
    return records
      .filter((item) =>
        item.name.toLowerCase().includes(query) ||
        item.country.toLowerCase().includes(query) ||
        item.bank.toLowerCase().includes(query) ||
        item.account.toLowerCase().includes(query)
      )
      .slice(0, 6);
  }, [recipientSearch, savedRecipients]);

  const converted = useMemo(() => {
    const value = Number.parseFloat(amount.value || '0');
    if (!Number.isFinite(value) || value <= 0) return null;
    const rate = RATES[amount.targetCurrency];
    return (value * rate).toLocaleString(undefined, {
      maximumFractionDigits: amount.targetCurrency === 'IDR' ? 0 : 2,
    });
  }, [amount.value, amount.targetCurrency]);

  function applySavedRecipient(saved: RecipientRecord) {
    const country = normalizeCountry(saved.country);
    setSelectedRecipientId(saved.id);
    set({
      recipient: {
        ...recipient,
        name: saved.name,
        country,
        rail: 'bank',
        bank: {
          swift: saved.swift ?? '',
          account: saved.account ?? '',
        },
      },
      amount: {
        ...amount,
        targetCurrency: COUNTRY_TO_CURRENCY[country],
      },
      deliveryTier: saved.tier,
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) next();
      }}
      className="space-y-5"
    >
      <div>
        <h2 className="text-xl font-bold text-[#326273]">Who are you paying?</h2>
        <p className="mt-1 text-sm text-[#326273]/60">Pick from saved recipients or enter a new beneficiary manually.</p>
      </div>

      <section className="rounded-2xl border border-[#326273]/10 bg-[#F4F8FA] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#5C9EAD]/12 text-[#326273]">
              <Users className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-[#0C3E48]">Saved recipients</h3>
              <p className="text-xs text-[#326273]/60">Use contacts already added on the Recipients page.</p>
            </div>
          </div>
          <div className="flex min-h-10 items-center gap-2 rounded-xl border border-[#326273]/12 bg-white px-3 shadow-sm sm:w-64">
            <Search className="size-4 shrink-0 text-[#326273]/40" aria-hidden="true" />
            <input
              value={recipientSearch}
              onChange={(event) => setRecipientSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-[#326273] outline-none placeholder:text-[#326273]/35"
              placeholder="Search contacts"
              aria-label="Search saved recipients"
            />
          </div>
        </div>

        <div className="mt-4">
          {loadingRecipients ? (
            <div className="flex items-center gap-2 rounded-xl border border-[#326273]/10 bg-white px-4 py-3 text-sm font-semibold text-[#326273]/65">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading saved recipients...
            </div>
          ) : recipientError ? (
            <div className="rounded-xl border border-[#E39774]/25 bg-[#E39774]/10 px-4 py-3 text-sm font-semibold text-[#9b4e32]">
              {recipientError}. You can still enter details manually.
            </div>
          ) : filteredRecipients.length > 0 ? (
            <div className="grid gap-2">
              {filteredRecipients.map((saved) => {
                const active = selectedRecipientId === saved.id;
                return (
                  <button
                    key={saved.id}
                    type="button"
                    onClick={() => applySavedRecipient(saved)}
                    className={`flex items-center gap-3 rounded-xl border bg-white p-3 text-left transition-all hover:border-[#5C9EAD]/70 hover:bg-[#F8FCFD] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5C9EAD]/20 ${
                      active ? 'border-[#5C9EAD] shadow-[inset_3px_0_0_#5C9EAD,0_10px_22px_rgba(12,62,72,0.07)]' : 'border-[#326273]/10'
                    }`}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#5C9EAD]/10 text-[#326273]">
                      <Building2 className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-[#0C3E48]">{saved.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[#326273]/60">
                        <span>{saved.country}</span>
                        <span>{saved.bank || 'Bank details'}</span>
                        <span className="font-mono">{saved.account}</span>
                      </span>
                    </span>
                    {active ? <Check className="size-4 shrink-0 text-[#5C9EAD]" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#326273]/18 bg-white px-4 py-4 text-sm text-[#326273]/60">
              No saved recipients match this search. Add a contact on the Recipients page or continue manually below.
            </div>
          )}
        </div>
      </section>

      <Field label="Recipient name">
        <input
          value={recipient.name}
          onChange={(event) => {
            setSelectedRecipientId(null);
            set({ recipient: { ...recipient, name: event.target.value } });
          }}
          className="w-full rounded-lg border border-[#326273]/20 bg-[#F6F0ED] px-4 py-3 text-[#326273] focus:border-[#5C9EAD] focus:outline-none"
          placeholder="Acme Trading Sdn Bhd"
          required
        />
      </Field>

      <Field label="Country">
        <select
          value={recipient.country}
          onChange={(event) => {
            const country = event.target.value as RecipientCountry;
            setSelectedRecipientId(null);
            set({
              recipient: { ...recipient, country },
              amount: { ...amount, targetCurrency: COUNTRY_TO_CURRENCY[country] },
            });
          }}
          className="w-full rounded-lg border border-[#326273]/20 bg-[#F6F0ED] px-4 py-3 text-[#326273] focus:border-[#5C9EAD] focus:outline-none"
        >
          <option value="MY">Malaysia</option>
          <option value="PH">Philippines</option>
          <option value="ID">Indonesia</option>
          <option value="SG">Singapore</option>
          <option value="VN">Vietnam</option>
          <option value="TH">Thailand</option>
          <option value="EU">European Union</option>
          <option value="GB">United Kingdom</option>
        </select>
      </Field>

      <Field label="Bank account">
        <input
          value={recipient.bank?.swift ?? ''}
          onChange={(event) => {
            setSelectedRecipientId(null);
            set({
              recipient: {
                ...recipient,
                bank: { ...(recipient.bank ?? { account: '' }), swift: event.target.value },
              },
            });
          }}
          className="w-full rounded-lg border border-[#326273]/20 bg-[#F6F0ED] px-4 py-3 text-[#326273] focus:border-[#5C9EAD] focus:outline-none"
          placeholder="SWIFT/BIC (optional)"
        />
        <input
          value={recipient.bank?.account ?? ''}
          onChange={(event) => {
            setSelectedRecipientId(null);
            set({
              recipient: {
                ...recipient,
                bank: { ...(recipient.bank ?? { swift: '' }), account: event.target.value },
              },
            });
          }}
          className="mt-2 w-full rounded-lg border border-[#326273]/20 bg-[#F6F0ED] px-4 py-3 font-mono text-[#326273] focus:border-[#5C9EAD] focus:outline-none"
          placeholder="Account number"
          required
        />
      </Field>

      <div className="space-y-3">
        <div className="rounded-xl border border-[#326273]/10 bg-[#F6F0ED] p-5">
          <div className="mb-2 text-xs text-[#326273]/60">You send (USD)</div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount.value}
            onChange={(event) => set({ amount: { ...amount, value: event.target.value } })}
            className="w-full bg-transparent text-3xl font-extrabold text-[#326273] focus:outline-none"
            placeholder="0.00"
            required
          />
        </div>

        <div className="flex justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5C9EAD]/10 text-[#5C9EAD]">
            <ArrowDown className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-[#5C9EAD]/20 bg-[#5C9EAD]/5 p-5">
          <div className="mb-2 text-xs text-[#326273]/60">Recipient receives ({amount.targetCurrency})</div>
          {converted ? (
            <div className="text-3xl font-extrabold text-[#5C9EAD]">
              {converted} <span className="text-lg">{amount.targetCurrency}</span>
            </div>
          ) : (
            <div className="text-3xl font-extrabold text-[#326273]/30">0.00 <span className="text-lg">{amount.targetCurrency}</span></div>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={!valid}
        className="w-full rounded-lg bg-[#326273] px-4 py-3 font-bold text-white shadow-sm transition-colors hover:bg-[#264e5b] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continue
      </button>
    </form>
  );
}

function normalizeCountry(country: string): RecipientCountry {
  if (SUPPORTED_COUNTRIES.has(country as RecipientCountry)) return country as RecipientCountry;
  return 'PH';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-[#326273]/70">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
