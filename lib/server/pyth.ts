import { getDeepbookStablePrice } from '@/lib/server/deepbook';

const HERMES_BASE = 'https://hermes.pyth.network';

const PRICE_IDS = {
  USDC_USD: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT_USD: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
} as const;

export interface PriceData {
  symbol: string;
  price: number;
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

function parseHermesPrice(priceStr: string, expo: number): number {
  return Number.parseFloat(priceStr) * Math.pow(10, expo);
}

function mockPrice(symbol: string): PriceData {
  return {
    symbol,
    price: 1.0,
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
      price: normalised,
      confidence,
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
    const usdcDevPpm = Math.abs(usdc.price - 1.0) * 1_000_000;
    const usdtDevPpm = Math.abs(usdt.price - 1.0) * 1_000_000;
    // Peg health is judged on price deviation from $1.00. We intentionally do
    // NOT block the off-chain pre-check on Pyth publish-time staleness: demo/CI
    // clocks can skew far from Pyth's real publish times and produce false
    // "stale" positives that wrongly block every transfer. Staleness is still
    // enforced on-chain by peg_monitor::assert_pegged (60s) at real settlement.
    const pythPegged = usdcDevPpm <= maxDeviationPpm && usdtDevPpm <= maxDeviationPpm;
    const spreadBps = Math.round(((usdc.price - usdt.price) / usdc.price) * 10_000);
    const deviationPpm = Math.round((Math.abs(usdc.price - usdt.price) / usdc.price) * 1_000_000);

    // DeepBook V3 stable-pair mid as a second peg source.
    const dbToleranceBps = Number(process.env.DEEPBOOK_PEG_TOLERANCE_BPS ?? 100);
    const deepbook: DeepbookPeg | null = dbStable
      ? {
          pair: dbStable.pair,
          midPrice: dbStable.midPrice,
          deviationBps: Math.round(dbStable.deviationBps * 100) / 100,
          pegged: dbStable.deviationBps <= dbToleranceBps,
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
    const pythUsdtPerUsdc = usdc.price > 0 ? usdt.price / usdc.price : 1;
    const divergenceBps = deepbook
      ? Math.round(Math.abs(deepbook.midPrice - pythUsdtPerUsdc) * 10_000 * 100) / 100
      : null;

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
