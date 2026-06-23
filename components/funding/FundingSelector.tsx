'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, CircleDollarSign, Coins, Landmark, Loader2, ShieldCheck } from 'lucide-react';

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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  CctpSourceChain,
  FundingRegistry,
  FundingSelection,
  StablecoinAssetSymbol,
  StablecoinRail,
  UsdProviderId,
} from '@/lib/funding/registry';
import { cn } from '@/lib/utils';

type FundingOptions = FundingRegistry & {
  suggestedUsdProvider: UsdProviderId | null;
  countryCode: string | null;
  demoMode: boolean;
};

export default function FundingSelector({
  selection,
  onChange,
  disabled = false,
}: {
  selection: FundingSelection;
  onChange: (selection: FundingSelection) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<FundingOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/funding/options')
      .then(async (response) => {
        if (!response.ok) throw new Error('Funding options are unavailable');
        return response.json() as Promise<FundingOptions>;
      })
      .then((body) => {
        if (cancelled) return;
        setOptions(body);
        if (selection.method === 'USD' && body.suggestedUsdProvider) {
          onChange({ method: 'USD', provider: body.suggestedUsdProvider, feeTier: 'STANDARD' });
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Funding options are unavailable');
      });
    return () => { cancelled = true; };
    // Geo suggestion is applied once when registry options arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Funding options unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!options) {
    return <div className="flex items-center gap-2 rounded-xl bg-[#F6F0ED] p-4 text-sm font-semibold text-[#326273]/65"><Loader2 className="animate-spin" /> Loading funding methods...</div>;
  }
  if (!options.featureEnabled) {
    return (
      <Alert>
        <AlertTitle>USD bank funding</AlertTitle>
        <AlertDescription>Dual funding is disabled. The existing USD bank flow remains available.</AlertDescription>
      </Alert>
    );
  }

  function changeMethod(method: 'USD' | 'STABLECOIN') {
    if (method === 'USD') {
      const provider = options?.suggestedUsdProvider ?? options?.usdProviders[0]?.id;
      if (provider) onChange({ method: 'USD', provider, feeTier: 'STANDARD' });
      return;
    }
    const asset = options?.stablecoinAssets[0];
    const rail = asset?.rails[0];
    if (!asset || !rail) return;
    onChange({
      method: 'STABLECOIN',
      asset: asset.symbol,
      rail,
      sourceChain: rail === 'CCTP' ? asset.cctpSourceChains[0] : undefined,
      feeTier: 'DISCOUNT',
    });
  }

  function changeAsset(symbol: StablecoinAssetSymbol) {
    const asset = options?.stablecoinAssets.find((item) => item.symbol === symbol);
    const rail = asset?.rails[0];
    if (!asset || !rail) return;
    onChange({
      method: 'STABLECOIN',
      asset: symbol,
      rail,
      sourceChain: rail === 'CCTP' ? asset.cctpSourceChains[0] : undefined,
      feeTier: 'DISCOUNT',
    });
  }

  function changeRail(rail: StablecoinRail) {
    if (selection.method !== 'STABLECOIN') return;
    const asset = options?.stablecoinAssets.find((item) => item.symbol === selection.asset);
    onChange({
      ...selection,
      rail,
      sourceChain: rail === 'CCTP' ? asset?.cctpSourceChains[0] : undefined,
    });
  }

  const selectedAsset = selection.method === 'STABLECOIN'
    ? options.stablecoinAssets.find((asset) => asset.symbol === selection.asset)
    : null;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-[#326273]/12 bg-white p-4 shadow-[0_16px_40px_rgba(12,62,72,0.08)] md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#5C9EAD]/14 text-[#326273]">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-bold text-[#0C3E48]">How will you fund this payment?</h3>
            <p className="mt-1 max-w-md text-xs leading-5 text-[#326273]/65">Both paths settle as native USDC before payout.</p>
          </div>
        </div>
        <div className="shrink-0 rounded-xl border border-[#326273]/10 bg-[#F6F0ED] px-3 py-2 text-right">
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#326273]/50">Pricing</span>
          <span className="mt-0.5 block text-xs font-bold text-[#0C3E48]">{selection.feeTier}</span>
        </div>
      </div>

      <ToggleGroup
        value={[selection.method]}
        onValueChange={(values) => values[0] && changeMethod(values[0] as 'USD' | 'STABLECOIN')}
        disabled={disabled}
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <ToggleGroupItem
          value="USD"
          aria-label="Pay in USD"
          className={cn(
            'h-auto min-h-28 w-full flex-col items-stretch rounded-2xl border p-4 text-left transition-[transform,box-shadow,border-color,background-color] duration-200',
            selection.method === 'USD'
              ? 'border-[#0C3E48] bg-[#0C3E48] text-white shadow-[0_12px_26px_rgba(12,62,72,0.18)] hover:bg-[#0C3E48] hover:text-white aria-pressed:bg-[#0C3E48]'
              : 'border-[#326273]/15 bg-[#F6F0ED]/45 text-[#0C3E48] shadow-sm hover:-translate-y-0.5 hover:border-[#5C9EAD] hover:bg-[#F6F0ED]/70 hover:text-[#0C3E48]',
          )}
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span className={cn('flex size-9 items-center justify-center rounded-xl', selection.method === 'USD' ? 'bg-white/12 text-white' : 'bg-[#5C9EAD]/14 text-[#326273]')}>
              <Landmark className="size-4" aria-hidden="true" />
            </span>
            <span className={cn('flex size-6 items-center justify-center rounded-full border', selection.method === 'USD' ? 'border-[#5C9EAD] bg-[#5C9EAD] text-white' : 'border-[#326273]/20 text-transparent')}>
              <Check className="size-3.5" aria-hidden="true" />
            </span>
          </span>
          <span className="mt-3 flex flex-col gap-1">
            <strong>Pay in USD</strong>
            <span className={cn('text-xs font-normal', selection.method === 'USD' ? 'text-white/65' : 'text-[#326273]/60')}>ACH, wire, or FPX</span>
          </span>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="STABLECOIN"
          aria-label="Pay with Stablecoin"
          className={cn(
            'h-auto min-h-28 w-full flex-col items-stretch rounded-2xl border p-4 text-left transition-[transform,box-shadow,border-color,background-color] duration-200',
            selection.method === 'STABLECOIN'
              ? 'border-[#0C3E48] bg-[#0C3E48] text-white shadow-[0_12px_26px_rgba(12,62,72,0.18)] hover:bg-[#0C3E48] hover:text-white aria-pressed:bg-[#0C3E48]'
              : 'border-[#326273]/15 bg-[#F6F0ED]/45 text-[#0C3E48] shadow-sm hover:-translate-y-0.5 hover:border-[#5C9EAD] hover:bg-[#F6F0ED]/70 hover:text-[#0C3E48]',
          )}
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span className={cn('flex size-9 items-center justify-center rounded-xl', selection.method === 'STABLECOIN' ? 'bg-white/12 text-white' : 'bg-[#E39774]/16 text-[#9F5839]')}>
              <Coins className="size-4" aria-hidden="true" />
            </span>
            <span className={cn('flex size-6 items-center justify-center rounded-full border', selection.method === 'STABLECOIN' ? 'border-[#5C9EAD] bg-[#5C9EAD] text-white' : 'border-[#326273]/20 text-transparent')}>
              <Check className="size-3.5" aria-hidden="true" />
            </span>
          </span>
          <span className="mt-3 flex flex-col gap-1">
            <strong>Pay with Stablecoin</strong>
            <span className={cn('text-xs font-normal', selection.method === 'STABLECOIN' ? 'text-white/65' : 'text-[#326273]/60')}>Deposit address + QR</span>
          </span>
        </ToggleGroupItem>
      </ToggleGroup>

      {selection.method === 'USD' ? (
        <Card className="gap-4 border-[#326273]/10 bg-[#F6F0ED]/40 py-4 shadow-none">
          <CardHeader className="gap-1 px-4">
            <CardTitle className="text-sm text-[#0C3E48]">Choose a USD provider</CardTitle>
            <CardDescription className="text-xs leading-5 text-[#326273]/60">{options.countryCode === 'MY' ? 'Airwallex is suggested for Malaysia. Both providers remain selectable.' : 'Stripe is suggested for your region. Both providers remain selectable.'}</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <ToggleGroup
              value={[selection.provider]}
              onValueChange={(values) => values[0] && onChange({ method: 'USD', provider: values[0] as UsdProviderId, feeTier: 'STANDARD' })}
              disabled={disabled}
              className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {options.usdProviders.map((provider) => (
                <ToggleGroupItem
                  key={provider.id}
                  value={provider.id}
                  className={cn(
                    'h-auto w-full justify-start rounded-xl border p-3 text-left text-[#0C3E48] hover:border-[#5C9EAD] hover:text-[#0C3E48]',
                    selection.provider === provider.id
                      ? 'border-[#5C9EAD] bg-[#5C9EAD]/12 shadow-[inset_3px_0_0_#5C9EAD] hover:bg-[#5C9EAD]/12 aria-pressed:bg-[#5C9EAD]/12'
                      : 'border-[#326273]/12 bg-white shadow-sm hover:bg-white',
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#5C9EAD]/12 text-[#326273]">
                    {provider.id === 'STRIPE' ? <CircleDollarSign className="size-4" aria-hidden="true" /> : <Building2 className="size-4" aria-hidden="true" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col items-start">
                    <strong>{provider.label}</strong>
                    <span className="text-xs font-normal text-[#326273]/60">{provider.rails.join(' / ')}</span>
                  </span>
                  {selection.provider === provider.id ? <Check className="size-4 shrink-0 text-[#326273]" aria-hidden="true" /> : null}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-4 border-[#326273]/10 bg-[#F6F0ED]/40 py-4 shadow-none">
          <CardHeader className="gap-1 px-4">
            <CardTitle className="text-sm text-[#0C3E48]">Stablecoin deposit</CardTitle>
            <CardDescription className="text-xs leading-5 text-[#326273]/60">Choose an enabled asset and rail. Deposits use a push-only address flow.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-4">
            <ToggleGroup
              value={[selection.asset]}
              onValueChange={(values) => values[0] && changeAsset(values[0] as StablecoinAssetSymbol)}
              disabled={disabled}
              className="flex w-full flex-wrap gap-2"
            >
              {options.stablecoinAssets.map((asset) => (
                <ToggleGroupItem
                  key={asset.symbol}
                  value={asset.symbol}
                  className={cn(
                    'h-auto min-w-24 flex-1 rounded-xl border px-4 py-3 text-[#0C3E48] hover:border-[#5C9EAD] hover:text-[#0C3E48]',
                    selection.asset === asset.symbol
                      ? 'border-[#5C9EAD] bg-[#5C9EAD]/12 shadow-[inset_0_-3px_0_#5C9EAD] hover:bg-[#5C9EAD]/12 aria-pressed:bg-[#5C9EAD]/12'
                      : 'border-[#326273]/12 bg-white shadow-sm hover:bg-white',
                  )}
                >
                  {asset.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {selectedAsset && selectedAsset.rails.length > 1 ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-[#326273]/55">Rail</span>
                <ToggleGroup
                  value={[selection.rail]}
                  onValueChange={(values) => values[0] && changeRail(values[0] as StablecoinRail)}
                  disabled={disabled}
                  className="grid w-full grid-cols-2 gap-2"
                >
                  {selectedAsset.rails.map((rail) => (
                    <ToggleGroupItem
                      key={rail}
                      value={rail}
                      className={cn(
                        'h-auto w-full rounded-xl border px-4 py-3 text-[#0C3E48] hover:border-[#5C9EAD] hover:text-[#0C3E48]',
                        selection.rail === rail
                          ? 'border-[#5C9EAD] bg-[#5C9EAD]/12 shadow-[inset_0_-3px_0_#5C9EAD] hover:bg-[#5C9EAD]/12 aria-pressed:bg-[#5C9EAD]/12'
                          : 'border-[#326273]/12 bg-white shadow-sm hover:bg-white',
                      )}
                    >
                      {rail === 'SUI_NATIVE' ? 'Sui native' : 'Circle CCTP'}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            ) : null}

            {selection.rail === 'CCTP' ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-wide text-[#326273]/55" htmlFor="cctp-source-chain">Source chain</label>
                <Select
                  value={selection.sourceChain ?? null}
                  onValueChange={(value) => value && onChange({ ...selection, sourceChain: value as CctpSourceChain })}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
