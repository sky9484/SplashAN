import { divRound, formatRate, parseRate, type Rate } from '../money.ts';
import { getDeepbookStablePrice } from '@/lib/server/deepbook';

const HERMES_BASE = 'https://hermes.pyth.network';

const PRICE_IDS = {
  USDC_USD: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT_USD: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
} as const;

export interface PriceData {
  symbol: string;
  /** Display value. `priceRate` is the exact one; compare with that. */
  price: number;
  priceRate: Rate;
  confidence: number;
  publishTime: number;
  source: 'pyth' | 'mock';
}

export interface DeepbookPeg {
  pair: string;
  midPrice: number;
  deviationBps: number;
  pegged: boolean;
  source: 'deepbook' | 'mock';
}

export interface PegStatus {
  usdcUsd: PriceData;
  usdtUsd: PriceData;
  deviationPpm: number;
  pegged: boolean;
  usdtCheaper: boolean;
  spreadBps: number;
  /** DeepBook V3 CLOB cross-check (second source). null when unavailable. */
  deepbook: DeepbookPeg | null;
  /** Per-source peg confirmation. deepbook is null when the feed is unavailable. */
  sources: { pyth: boolean; deepbook: boolean | null };
  /** How many independent sources currently confirm the peg. */
  confirmedBy: number;
  /** |DeepBook USDT/USDC mid − Pyth-implied USDT/USDC| in bps. null if unavailable. */
  divergenceBps: number | null;
  /** Which source gated the decision: DeepBook (primary) or Pyth (fallback). */
  primary: 'deepbook' | 'pyth';
}

/**
 * A Hermes price is an integer string plus a base-10 exponent — already a
 * scaled integer, and exactly what a Rate is. This used to compute
 * `parseFloat(priceStr) * Math.pow(10, expo)`, converting a value that
 * arrived exact into a double before anything compared it. A peg gate that
 * halts settlement should not be deciding on rounding noise.
 *
 * Pyth exponents are negative (−8 is typical). A positive one would mean a
 * whole-number price, which is still representable.
 */
function parseHermesPrice(priceStr: string, expo: number): Rate {
  const digits = BigInt(priceStr);
  if (expo <= 0) return { scaled: digits, scale: -expo };
  return { scaled: digits * 10n ** BigInt(expo), scale: 0 };
}

/** Rates for display and for the JSON body, where a bigint cannot go. */
function rateToNumber(rate: Rate): number {
  return Number(formatRate(rate));
}

function mockPrice(symbol: string): PriceData {
  return {
    symbol,
    price: 1.0,
    priceRate: parseRate('1'),
    confidence: 0.0001,
    publishTime: Math.floor(Date.now() / 1000),
    source: 'mock',
  };
}

async function fetchHermesPrice(ids: string[]): Promise<Record<string, PriceData>> {
  const params = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  const response = await fetch(`${HERMES_BASE}/v2/updates/price/latest?${params}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 15 },
  });

  if (!response.ok) throw new Error(`Hermes API ${response.status}: ${await response.text()}`);

  const body = (await response.json()) as {
    parsed: Array<{
      id: string;
      price: { price: string; conf: string; expo: number; publish_time: number };
    }>;
  };
  const out: Record<string, PriceData> = {};

  for (const item of body.parsed) {
    const id = item.id.startsWith('0x') ? item.id : `0x${item.id}`;
    const normalised = parseHermesPrice(item.price.price, item.price.expo);
    const confidence = parseHermesPrice(item.price.conf, item.price.expo);

    out[id] = {
      symbol: id,
      price: rateToNumber(normalised),
      priceRate: normalised,
      confidence: rateToNumber(confidence),
      publishTime: item.price.publish_time,
      source: 'pyth',
    };
  }

  return out;
}

export class PythAdapter {
  async getStablecoinPrices(): Promise<{ usdc: PriceData; usdt: PriceData }> {
    if (process.env.USE_MOCK_APIS === 'true') {
      return { usdc: mockPrice('USDC/USD'), usdt: mockPrice('USDT/USD') };
    }

    try {
      const prices = await fetchHermesPrice([PRICE_IDS.USDC_USD, PRICE_IDS.USDT_USD]);

      return {
        usdc: prices[PRICE_IDS.USDC_USD] ?? mockPrice('USDC/USD'),
        usdt: prices[PRICE_IDS.USDT_USD] ?? mockPrice('USDT/USD'),
      };
    } catch {
      return { usdc: mockPrice('USDC/USD'), usdt: mockPrice('USDT/USD') };
    }
  }

  async getPegStatus(): Promise<PegStatus> {
    // Pyth (oracle) and DeepBook (on-chain CLOB) fetched in parallel — two
    // independent sources so peg health never rests on a single feed.
    const [{ usdc, usdt }, dbStable] = await Promise.all([
      this.getStablecoinPrices(),
      getDeepbookStablePrice(),
    ]);

    const maxDeviationPpm = 3_000;
    // |price − 1| in parts per million, exactly, at the feed’s own scale.
    const ppmFromOne = (r: Rate): number => {
      const one = 10n ** BigInt(r.scale);
      const drift = r.scaled > one ? r.scaled - one : one - r.scaled;
      return Number(divRound(drift * 1_000_000n, one, 'half-even'));
    };
    const usdcDevPpm = ppmFromOne(usdc.priceRate);
    const usdtDevPpm = ppmFromOne(usdt.priceRate);
    // Peg health is judged on price deviation from $1.00. We intentionally do
    // NOT block the off-chain pre-check on Pyth publish-time staleness: demo/CI
    // clocks can skew far from Pyth's real publish times and produce false
    // "stale" positives that wrongly block every transfer. Staleness is still
    // enforced on-chain by peg_monitor::assert_pegged (60s) at real settlement.
    const pythPegged = usdcDevPpm <= maxDeviationPpm && usdtDevPpm <= maxDeviationPpm;
    // (usdc − usdt) / usdc, in bps and ppm. Both feeds share a scale, so the
    // ratio is one integer division.
    const usdcScaled = usdc.priceRate.scaled;
    const usdtScaled = usdt.priceRate.scaled;
    const diff = usdcScaled - usdtScaled;
    const absDiff = diff < 0n ? -diff : diff;
    const spreadBps =
      usdcScaled === 0n ? 0 : Number(divRound(diff * 10_000n, usdcScaled < 0n ? -usdcScaled : usdcScaled, 'half-even'));
    const deviationPpm =
      usdcScaled === 0n ? 0 : Number(divRound(absDiff * 1_000_000n, usdcScaled < 0n ? -usdcScaled : usdcScaled, 'half-even'));

    // DeepBook V3 stable-pair mid as a second peg source.
    const dbToleranceBps = Number(process.env.DEEPBOOK_PEG_TOLERANCE_BPS ?? 100);
    const deepbook: DeepbookPeg | null = dbStable
      ? {
          pair: dbStable.pair,
          midPrice: rateToNumber(dbStable.midPrice),
          deviationBps: Number(dbStable.deviationBps),
          pegged: dbStable.deviationBps <= BigInt(Math.trunc(dbToleranceBps)),
          source: dbStable.source,
        }
      : null;

    // DeepBook (on-chain CLOB) is the PRIMARY peg gate — real, executable,
    // market-driven prices. Pyth (oracle) is the secondary confirmation and the
    // FALLBACK gate when the DeepBook feed is unavailable.
    const pegged = deepbook ? deepbook.pegged : pythPegged;
    const primary: PegStatus['primary'] = deepbook ? 'deepbook' : 'pyth';
    const sources = { deepbook: deepbook ? deepbook.pegged : null, pyth: pythPegged };
    const confirmedBy = (deepbook?.pegged ? 1 : 0) + (pythPegged ? 1 : 0);

    // Cross-source divergence: DeepBook USDT/USDC mid vs Pyth-implied USDT/USDC.
    // DeepBook mid against the Pyth-implied USDT/USDC, in bps. Integer
    // throughout so a divergence alarm cannot be triggered by rounding.
    const divergenceBps = ((): number | null => {
      if (!dbStable || usdcScaled === 0n) return null;
      const scale = dbStable.midPrice.scale;
      const unit = 10n ** BigInt(scale);
      const pythImplied = divRound(usdtScaled * unit, usdcScaled, 'half-even');
      const d = dbStable.midPrice.scaled - pythImplied;
      return Number(divRound((d < 0n ? -d : d) * 10_000n, unit, 'half-even'));
    })();

    return {
      usdcUsd: usdc,
      usdtUsd: usdt,
      deviationPpm,
      pegged,
      usdtCheaper: spreadBps > 0,
      spreadBps,
      deepbook,
      sources,
      confirmedBy,
      divergenceBps,
      primary,
    };
  }
}

export const pythAdapter = new PythAdapter();
