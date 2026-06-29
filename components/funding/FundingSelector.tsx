'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Landmark,
  Loader2,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  CctpSourceChain,
  FundingRegistry,
  FundingSelection,
  FundingSourceId,
  FundingSourceOption,
  StablecoinAsset,
  StablecoinRail,
  UsdProviderId,
} from '@/lib/funding/registry';
import { cn } from '@/lib/utils';

type FundingOptions = FundingRegistry & {
  sources: FundingSourceOption[];
  defaultSource: FundingSourceId | null;
  defaultSelection: FundingSelection | null;
  heldBalanceMicro: number;
  heldBalanceUsdc: string;
  lastUsedSource: FundingSourceId | null;
  businessAccountId: string;
  suggestedUsdProvider: UsdProviderId | null;
  countryCode: string | null;
  demoMode: boolean;
};

export default function FundingSelector({
  selection,
  onChange,
  amountUsd,
  businessAccountId,
  disabled = false,
}: {
  selection: FundingSelection;
  onChange: (selection: FundingSelection) => void;
  amountUsd: number;
  businessAccountId?: string;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<FundingOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectionRef = useRef(selection);
  const onChangeRef = useRef(onChange);
  const userSelectedRef = useRef(false);
  const defaultAppliedRef = useRef(false);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      amountUsd: Number.isFinite(amountUsd) && amountUsd > 0 ? String(amountUsd) : '0',
    });
    if (businessAccountId) params.set('businessAccountId', businessAccountId);
    void fetch(`/api/funding/options?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Funding sources are unavailable');
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) throw new Error('Funding sources returned an unexpected response');
        return response.json() as Promise<FundingOptions>;
      })
      .then((body) => {
        setError(null);
        setOptions(body);
        const selectionAvailable = isSelectionAvailable(selectionRef.current, body);
        if (!defaultAppliedRef.current && !userSelectedRef.current && !selectionAvailable && body.defaultSelection) {
          defaultAppliedRef.current = true;
          selectionRef.current = body.defaultSelection;
          onChangeRef.current(body.defaultSelection);
          return;
        }
        defaultAppliedRef.current = true;
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setError(fetchError instanceof Error ? fetchError.message : 'Funding sources are unavailable');
      });
    return () => controller.abort();
  }, [amountUsd, businessAccountId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Payment sources unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!options) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[#F6F0ED] p-4 text-sm font-semibold text-[#326273]/65">
        <Loader2 className="size-4 animate-spin" />
        Loading payment sources...
      </div>
    );
  }

  if (!options.featureEnabled) {
    return (
      <Alert>
        <AlertTitle>Bank funding</AlertTitle>
        <AlertDescription>Dual funding is disabled. The existing bank source remains available.</AlertDescription>
      </Alert>
    );
  }

  const currentSource = options.sources.find((source) => source.id === selection.source)
    ?? options.sources.find((source) => source.id === options.defaultSource)
    ?? options.sources[0];
  const selectedAsset = selection.type === 'stablecoin'
    ? options.stablecoinAssets.find((asset) => asset.symbol === selection.asset) ?? null
    : null;
  const fundingOptions = options;

  function selectSource(sourceId: FundingSourceId) {
    const source = fundingOptions.sources.find((item) => item.id === sourceId);
    if (!source || !source.enabled || disabled) return;
    const nextSelection = selectionFromSource(source.id, fundingOptions);
    if (!nextSelection) return;
    userSelectedRef.current = true;
    selectionRef.current = nextSelection;
    onChange(nextSelection);
  }

  function changeProvider(provider: UsdProviderId) {
    const nextSelection: FundingSelection = { source: 'BANK_USD', type: 'fiat', provider, feeTier: 'STANDARD' };
    userSelectedRef.current = true;
    selectionRef.current = nextSelection;
    onChange(nextSelection);
  }

  function changeRail(rail: StablecoinRail) {
    if (selection.type !== 'stablecoin') return;
    const asset = fundingOptions.stablecoinAssets.find((item) => item.symbol === selection.asset);
    const nextSelection: FundingSelection = {
      ...selection,
      rail,
      sourceChain: rail === 'CCTP' ? asset?.cctpSourceChains[0] : undefined,
    };
    userSelectedRef.current = true;
    selectionRef.current = nextSelection;
    onChange(nextSelection);
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-[#326273]/12 bg-white p-4 shadow-[0_16px_40px_rgba(12,62,72,0.08)] md:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#5C9EAD]/14 text-[#326273]">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-bold text-[#0C3E48]">Pay from</h3>
            <p className="mt-1 max-w-md text-xs leading-5 text-[#326273]/65">
              Choose the source for this payment. Every source settles as native USDC before payout.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-[#326273]/10 bg-[#F6F0ED] px-3 py-2 text-left sm:text-right">
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#326273]/50">Applied fee</span>
          <span className="mt-0.5 block text-xs font-bold text-[#0C3E48]">{selection.feeTier}</span>
        </div>
      </div>

      {currentSource ? (
        <div className="rounded-2xl border border-[#0C3E48] bg-[#0C3E48] p-4 text-white shadow-[0_14px_32px_rgba(12,62,72,0.18)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/12">
                <SourceIcon source={currentSource} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-extrabold">{currentSource.label}</h4>
                  <FeePill tier={currentSource.feeTier} active />
                  {currentSource.instant ? <span className="rounded-full bg-[#5C9EAD]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#bfe6ee]">Instant</span> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-white/66">{summaryForSelection(selection, currentSource)}</p>
              </div>
            </div>
            <label className="flex w-full flex-col gap-1 text-xs font-bold text-white/70 sm:w-auto">
              Payment source
              <span className="relative block w-full sm:w-56">
                <select
                  value={currentSource.id}
                  disabled={disabled}
                  onChange={(event) => selectSource(event.target.value as FundingSourceId)}
                  className="h-11 w-full appearance-none rounded-xl border border-white/20 bg-white px-3 py-2 pr-9 text-sm font-extrabold text-[#0C3E48] shadow-[0_10px_24px_rgba(2,20,24,0.16)] outline-none transition-all hover:border-white/55 hover:bg-[#F8FCFD] focus:border-[#CBEFF5] focus:ring-4 focus:ring-[#5C9EAD]/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/35 disabled:text-white/60 disabled:shadow-none [&_option]:bg-white [&_option]:text-[#0C3E48]"
                >
                  {options.sources.map((source) => (
                    <option key={source.id} value={source.id} disabled={!source.enabled}>
                      {source.label}{!source.enabled && source.unavailableReason ? ` - ${source.unavailableReason}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#0C3E48]/65" aria-hidden="true" />
              </span>
            </label>
          </div>
        </div>
      ) : null}

      <ContextualFlow
        selection={selection}
        options={fundingOptions}
        selectedAsset={selectedAsset}
        disabled={disabled}
        onProviderChange={changeProvider}
        onRailChange={changeRail}
        onChainChange={(sourceChain) => {
          if (selection.type !== 'stablecoin') return;
          const nextSelection: FundingSelection = { ...selection, sourceChain };
          userSelectedRef.current = true;
          selectionRef.current = nextSelection;
          onChange(nextSelection);
        }}
      />
    </div>
  );
}

function isSelectionAvailable(selection: FundingSelection, options: FundingOptions) {
  const source = options.sources.find((item) => item.id === selection.source);
  if (!source?.enabled) return false;
  if (selection.type === 'held') return source.type === 'held';
  if (selection.type === 'fiat') {
    return source.type === 'fiat' && options.usdProviders.some((provider) => provider.id === selection.provider);
  }
  return source.type === 'stablecoin'
    && selection.source === selection.asset
    && options.stablecoinAssets.some((asset) => asset.symbol === selection.asset && asset.rails.includes(selection.rail));
}

function selectionFromSource(source: FundingSourceId, options: FundingOptions): FundingSelection | null {
  if (source === 'SPLASH_BALANCE') return { source: 'SPLASH_BALANCE', type: 'held', feeTier: 'DISCOUNT' };
  if (source === 'BANK_USD') {
    const provider = options.suggestedUsdProvider ?? options.usdProviders[0]?.id;
    return provider ? { source: 'BANK_USD', type: 'fiat', provider, feeTier: 'STANDARD' } : null;
  }
  const asset = options.stablecoinAssets.find((item) => item.symbol === source);
  if (!asset?.rails[0]) return null;
  const rail = asset.rails[0];
  return {
    source: asset.symbol,
    type: 'stablecoin',
    asset: asset.symbol,
    rail,
    sourceChain: rail === 'CCTP' ? asset.cctpSourceChains[0] : undefined,
    feeTier: 'DISCOUNT',
  };
}

function summaryForSelection(selection: FundingSelection, source: FundingSourceOption) {
  if (selection.type === 'held') return 'Debit held native USDC balance; no funding sub-flow required.';
  if (selection.type === 'fiat') return `Provider: ${selection.provider}. ${source.description}`;
  return `${selection.asset} over ${selection.rail}${selection.sourceChain ? ` from ${selection.sourceChain}` : ''}. ${source.description}`;
}

function SourceIcon({ source }: { source: FundingSourceOption }) {
  if (source.type === 'held') return <WalletCards className="size-4" aria-hidden="true" />;
  if (source.type === 'fiat') return <Landmark className="size-4" aria-hidden="true" />;
  return <Coins className="size-4" aria-hidden="true" />;
}

function FeePill({ tier, active = false }: { tier: FundingSelection['feeTier']; active?: boolean }) {
  return (
    <span className={cn(
      'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
      active
        ? tier === 'DISCOUNT' ? 'bg-[#5C9EAD]/24 text-[#c6eef5]' : 'bg-white/12 text-white/70'
        : tier === 'DISCOUNT' ? 'bg-[#5C9EAD]/12 text-[#326273]' : 'bg-[#E39774]/13 text-[#9b4e32]',
    )}
    >
      {tier}
    </span>
  );
}

function ContextualFlow({
  selection,
  options,
  selectedAsset,
  disabled,
  onProviderChange,
  onRailChange,
  onChainChange,
}: {
  selection: FundingSelection;
  options: FundingOptions;
  selectedAsset: StablecoinAsset | null;
  disabled: boolean;
  onProviderChange: (provider: UsdProviderId) => void;
  onRailChange: (rail: StablecoinRail) => void;
  onChainChange: (sourceChain: CctpSourceChain) => void;
}) {
  if (selection.type === 'held') {
    return (
      <Card className="gap-4 border-[#326273]/10 bg-[#F6F0ED]/45 py-4 shadow-none">
        <CardHeader className="gap-1 px-4">
          <CardTitle className="text-sm text-[#0C3E48]">Ready to settle from balance</CardTitle>
          <CardDescription className="text-xs leading-5 text-[#326273]/60">
            Splash will debit held native USDC at confirmation. Available balance: {options.heldBalanceUsdc} USDC.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (selection.type === 'fiat') {
    return (
      <Card className="gap-4 border-[#326273]/10 bg-[#F6F0ED]/45 py-4 shadow-none">
        <CardHeader className="gap-1 px-4">
          <CardTitle className="text-sm text-[#0C3E48]">Choose provider</CardTitle>
          <CardDescription className="text-xs leading-5 text-[#326273]/60">
            {options.countryCode === 'MY' ? 'Airwallex is suggested for Malaysia. Both providers remain selectable.' : 'Stripe is suggested for your region. Both providers remain selectable.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-4 sm:grid-cols-2">
          {options.usdProviders.map((provider) => {
            const active = selection.provider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                disabled={disabled}
                onClick={() => onProviderChange(provider.id)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5C9EAD]/18 disabled:cursor-not-allowed disabled:opacity-60',
                  active
                    ? 'border-[#5C9EAD] bg-[#EAF7F8] shadow-[inset_3px_0_0_#5C9EAD,0_10px_22px_rgba(12,62,72,0.08)]'
                    : 'border-[#326273]/12 bg-white hover:border-[#5C9EAD]/70 hover:bg-[#F8FCFD]',
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#5C9EAD]/12 text-[#326273]">
                  {provider.id === 'STRIPE' ? <CircleDollarSign className="size-4" aria-hidden="true" /> : <Building2 className="size-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-[#0C3E48]">{provider.label}</span>
                  <span className="block text-xs text-[#326273]/60">{provider.rails.join(' / ')}</span>
                </span>
                {active ? <Check className="size-4 shrink-0 text-[#326273]" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-4 border-[#326273]/10 bg-[#F6F0ED]/45 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="text-sm text-[#0C3E48]">Choose rail</CardTitle>
        <CardDescription className="text-xs leading-5 text-[#326273]/60">
          Deposit details and QR appear after confirmation. CCTP must mint native USDC on Sui; wrapped assets are rejected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        {selectedAsset && selectedAsset.rails.length > 1 ? (
          <div className="grid w-full grid-cols-2 gap-2">
            {selectedAsset.rails.map((rail) => (
              <button
                key={rail}
                type="button"
                disabled={disabled}
                onClick={() => onRailChange(rail)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-sm font-bold text-[#0C3E48] transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5C9EAD]/18 disabled:cursor-not-allowed disabled:opacity-60',
                  selection.rail === rail
                    ? 'border-[#5C9EAD] bg-[#EAF7F8] shadow-[inset_0_-3px_0_#5C9EAD,0_10px_22px_rgba(12,62,72,0.08)]'
                    : 'border-[#326273]/12 bg-white hover:border-[#5C9EAD]/70 hover:bg-[#F8FCFD]',
                )}
              >
                {rail === 'SUI_NATIVE' ? 'Sui native' : 'Circle CCTP'}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-[#5C9EAD]/25 bg-white p-3 text-sm text-[#326273]">
            <span className="font-bold">{selection.asset}</span> uses the Sui native rail for this source.
          </div>
        )}

        {selection.rail === 'CCTP' ? (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wide text-[#326273]/55" htmlFor="cctp-source-chain">Source chain</label>
            <Select
              value={selection.sourceChain ?? undefined}
              onValueChange={(value) => onChainChange(value as CctpSourceChain)}
              disabled={disabled}
            >
              <SelectTrigger id="cctp-source-chain" className="w-full bg-white">
                <SelectValue placeholder="Select source chain" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {selectedAsset?.cctpSourceChains.map((chain) => <SelectItem key={chain} value={chain}>{chain}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="rounded-xl border border-[#326273]/10 bg-white p-3 text-xs leading-5 text-[#326273]/65">
          <Banknote className="mr-2 inline size-4 text-[#5C9EAD]" aria-hidden="true" />
          {selection.asset} will normalize to native USDC before payment_router.
        </div>
      </CardContent>
    </Card>
  );
}
