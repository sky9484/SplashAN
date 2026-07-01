/**
 * DeepBook V3 — Sui's native central-limit order book — as a SECOND peg source.
 *
 * Pyth gives us USDC/USD and USDT/USD oracle prices. DeepBook gives us a real
 * on-chain USDT↔USDC CLOB mid-price: an independent, market-driven confirmation
 * of the stablecoin peg that doesn't rely on a single oracle. If the two sources
 * disagree, the peg monitor can flag it instead of trusting one feed blindly.
 *
 * Read path: the DeepBook Indexer REST `/summary` (per-pair last_price +
 * top-of-book). The peg is a real-world market fact, so we default to the
 * MAINNET indexer (deepest stablecoin liquidity) even on a testnet deployment;
 * override via env. Never throws — returns null so the peg monitor falls back
 * to Pyth-only.
 *
 * Env:
 *   DEEPBOOK_INDEXER_URL   default https://deepbook-indexer.mainnet.mystenlabs.com
 *   DEEPBOOK_STABLE_PAIR   default WUSDT_USDC (USDT priced in USDC)
 *   DEEPBOOK_TIMEOUT_MS    default 2500 (settlement pre-check must stay snappy)
 */

const DEFAULT_INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';
// Native USDT/USDC is the liquid stable pool (~66k vol). Wrapped/dead pools
// (WUSDT_USDC, WUSDC_USDC, AUSD_USDC) have junk top-of-book and are rejected.
const DEFAULT_PAIR = 'USDT_USDC';
const STABLES = ['USDC', 'WUSDC', 'USDT', 'WUSDT', 'AUSD', 'USDY', 'USDD', 'BUSD'];

export interface DeepbookStable {
  pair: string;
  /** Mid-price of the stable/stable pair (≈ 1.0 when pegged). */
  midPrice: number;
  lastPrice: number;
  /** |mid − 1| × 10_000 — peg deviation in basis points. */
  deviationBps: number;
  source: 'deepbook' | 'mock';
  asOf: string;
}

type SummaryItem = {
  trading_pairs: string;
  base_currency: string;
  quote_currency: string;
  last_price: number;
  highest_bid: number;
  lowest_ask: number;
  base_volume: number;
};

function indexerUrl(): string {
  return (process.env.DEEPBOOK_INDEXER_URL ?? DEFAULT_INDEXER).replace(/\/+$/, '');
}

/**
 * Current DeepBook stable-pair price. Returns null on any error / no stable pool
 * / timeout, so callers degrade to Pyth-only.
 */
export async function getDeepbookStablePrice(): Promise<DeepbookStable | null> {
  if (process.env.USE_MOCK_APIS === 'true') {
    return { pair: 'MOCK_USDT_USDC', midPrice: 1, lastPrice: 1, deviationBps: 0, source: 'mock', asOf: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPBOOK_TIMEOUT_MS ?? 2500));
  try {
    const res = await fetch(`${indexerUrl()}/summary`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as SummaryItem[];
    if (!Array.isArray(data)) return null;

    // A pool is only usable if its top-of-book is sane. Dead/empty pools list
    // junk quotes (e.g. WUSDT_USDC bid 0.987 / ask 1.078, or 0.10 / 99.99) that
    // would fake a depeg — reject anything with a >5% spread or non-positive book.
    const isLive = (d: SummaryItem) => {
      const bid = Number(d.highest_bid);
      const ask = Number(d.lowest_ask);
      return bid > 0 && ask > 0 && ask / bid < 1.05;
    };

    const want = (process.env.DEEPBOOK_STABLE_PAIR ?? DEFAULT_PAIR).toUpperCase();
    let item = data.find((d) => d.trading_pairs?.toUpperCase() === want && isLive(d));
    // Fallback: the most-liquid LIVE stable/stable pool.
    if (!item) {
      item = data
        .filter((d) => {
          const [base, quote] = (d.trading_pairs ?? '').toUpperCase().split('_');
          return STABLES.includes(base) && STABLES.includes(quote) && isLive(d);
        })
        .sort((a, b) => Number(b.base_volume) - Number(a.base_volume))[0];
    }
    if (!item) return null;

    const bid = Number(item.highest_bid);
    const ask = Number(item.lowest_ask);
    const last = Number(item.last_price);
    const mid = (bid + ask) / 2; // book validated as sane above
    if (!Number.isFinite(mid) || mid <= 0) return null;

    return {
      pair: item.trading_pairs,
      midPrice: mid,
      lastPrice: Number.isFinite(last) && last > 0 ? last : mid,
      deviationBps: Math.abs(mid - 1) * 10_000,
      source: 'deepbook',
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
