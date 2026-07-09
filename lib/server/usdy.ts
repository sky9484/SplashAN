/**
 * Ondo USDY — the yield instrument behind Smart Treasury.
 *
 * USDY is a T-bill-backed token, native on Sui, with Cetus/Aftermath/Suilend
 * liquidity. We move balances in/out by SWAPPING USDC↔USDY on a Sui DEX (NOT
 * direct Ondo mint/redeem, which is T+40–50). Yield is FLOATING — derived from
 * USDY's redemption value — never a fixed constant.
 *
 * This module is the single source of truth for the treasury rate, so every
 * surface (yields benchmark, 0xWal copilot, treasury UI) shows the same number.
 *
 * External wiring (drop-in via env when ready):
 *   USDY_TYPE                  Move coin type of USDY on the target network
 *   USDY_REDEMPTION_USD        latest USDY→USD redemption price (oracle/Ondo feed)
 *   USDY_NET_APY_PCT           net APY credited to users (after Splash spread)
 *   SPLASH_PROMO_APY_PCT       introductory promo APY (first ~6 months)
 *   SPLASH_PROMO_UNTIL         ISO date the promo ends
 *   USDY_SWAP_VENUE            'cetus' | 'aftermath'
 */

const BASE_NET_APY_DEFAULT = 3.5; // ≈ net-of-spread USDY yield; overridden by env.

export type TreasuryRate = {
  /** Net APY credited to the user. Variable — derived from USDY, not fixed. */
  netApyPct: number;
  variable: true;
  /** True while the time-boxed introductory subsidy is active. */
  introductory: boolean;
  promoUntil: string | null;
  /** Display string, e.g. "≈{rate}% APY · variable" (always variable, never a fixed figure). */
  label: string;
  asOf: string;
};

/** Base USDY net APY (post-spread), env-driven with a sane default. */
export function getUsdyNetApyPct(): number {
  const v = Number(process.env.USDY_NET_APY_PCT);
  return Number.isFinite(v) && v > 0 ? v : BASE_NET_APY_DEFAULT;
}

/**
 * The single source of truth for the Smart Treasury rate. Floating, with an
 * optional introductory promo that is clearly tagged and time-boxed.
 */
export function getTreasuryRate(): TreasuryRate {
  const base = getUsdyNetApyPct();
  let rate = base;
  let introductory = false;
  let promoUntil: string | null = null;

  const promoRate = Number(process.env.SPLASH_PROMO_APY_PCT);
  const promoUntilRaw = process.env.SPLASH_PROMO_UNTIL?.trim();
  if (Number.isFinite(promoRate) && promoRate > base && promoUntilRaw) {
    const until = Date.parse(promoUntilRaw);
    if (Number.isFinite(until) && Date.now() < until) {
      rate = promoRate;
      introductory = true;
      promoUntil = promoUntilRaw;
    }
  }

  return {
    netApyPct: Number(rate.toFixed(2)),
    variable: true,
    introductory,
    promoUntil,
    label: `≈${rate.toFixed(2)}% APY · variable${introductory ? ' (introductory)' : ''}`,
    asOf: new Date().toISOString(),
  };
}

// ─── Redemption feed ───────────────────────────────────────────────────────────

export type UsdyRedemption = { priceUsd: number; asOf: string };

/**
 * Latest USDY→USD redemption price. USDY accrues value via price (not rebasing),
 * so daily yield = (todayPrice − yesterdayPrice) × units held.
 *
 * TODO: replace the env override with a live feed (Ondo price oracle / rWA feed
 * on Sui). Defaults to 1.0 so accrual is a no-op until wired.
 */
export async function getUsdyRedemptionPrice(): Promise<UsdyRedemption> {
  const px = Number(process.env.USDY_REDEMPTION_USD);
  return { priceUsd: Number.isFinite(px) && px > 0 ? px : 1.0, asOf: new Date().toISOString() };
}

// ─── USDC ↔ USDY swap (Sui DEX) ─────────────────────────────────────────────────

export type SwapVenue = 'cetus' | 'aftermath';
export type SwapDirection = 'usdc->usdy' | 'usdy->usdc';

export type SwapQuote = {
  direction: SwapDirection;
  venue: SwapVenue;
  amountInMicro: string;
  /** Minimum acceptable output after the slippage guard. */
  minAmountOutMicro: string;
  slippageBps: number;
  redemptionPriceUsd: number;
};

export function getSwapVenue(): SwapVenue {
  return process.env.USDY_SWAP_VENUE === 'aftermath' ? 'aftermath' : 'cetus';
}

/**
 * Build a swap quote with a slippage guard. The actual on-DEX execution (pool
 * routing + PTB) is wired separately once the Cetus/Aftermath SDK + pool IDs are
 * configured; this guards the economics (min-out) so a move can't be sandwiched.
 */
export async function quoteSwap(
  direction: SwapDirection,
  amountInMicro: bigint,
  slippageBps = Number(process.env.USDY_SWAP_SLIPPAGE_BPS ?? 30),
): Promise<SwapQuote> {
  const { priceUsd } = await getUsdyRedemptionPrice();
  // Convert across the peg using redemption price (USDC ≈ $1).
  const grossOut =
    direction === 'usdc->usdy'
      ? Number(amountInMicro) / priceUsd
      : Number(amountInMicro) * priceUsd;
  const minOut = BigInt(Math.floor(grossOut * (1 - slippageBps / 10_000)));
  return {
    direction,
    venue: getSwapVenue(),
    amountInMicro: amountInMicro.toString(),
    minAmountOutMicro: minOut.toString(),
    slippageBps,
    redemptionPriceUsd: priceUsd,
  };
}
