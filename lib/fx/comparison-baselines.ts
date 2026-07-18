/**
 * W9.1 — comparison-strip baselines for the quote step.
 *
 * Per-corridor, category-level cost/delivery baselines for "what would this
 * payment cost elsewhere". These are ILLUSTRATIVE, MID-MARKET figures for a
 * generic provider CATEGORY — never a named competitor. Named competitors
 * stay off this strip until a sourced per-corridor number exists AND 0xSky
 * approves adding it to the claims register.
 *
 * Every entry carries `lastReviewed`; the UI must label the strip
 * "Illustrative, mid-market baseline". A corridor without an entry renders
 * no strip at all (hidden gracefully) — only ship corridors whose numbers
 * someone actually reviewed.
 */

export type CategoryBaseline = {
  /** FX margin + fees as a percentage of the send amount (mid-market). */
  pct: number;
  /** Flat fee component in USD (wire/processing). */
  flatUsd: number;
  /** Human delivery-time range for the category. */
  delivery: string;
};

export type ComparisonBaseline = {
  /** Target corridor currency (matches lib/fx/corridors.ts codes). */
  currency: string;
  fintech: CategoryBaseline;
  bankWire: CategoryBaseline;
  /** ISO date the numbers were last sanity-checked against public sources. */
  lastReviewed: string;
};

const BASELINES: Record<string, ComparisonBaseline> = {
  // USD → PHP (the live testnet corridor).
  // Sources (category aggregates, no named providers):
  // - World Bank Remittance Prices Worldwide (rpw.worldbank.org), digital
  //   MTO category into PHP — total cost commonly 1–3% for larger amounts.
  // - Typical correspondent-bank SWIFT wire: $25–50 flat + 2–4% FX margin,
  //   2–5 business day delivery (BSP consumer guidance ranges).
  PHP: {
    currency: 'PHP',
    fintech: { pct: 1.5, flatUsd: 4, delivery: '1–2 days' },
    bankWire: { pct: 2.5, flatUsd: 35, delivery: '2–5 days' },
    lastReviewed: '2026-07-18',
  },
};

/** Baseline for a corridor, or null when none has been reviewed — callers
 *  must hide the comparison strip entirely in the null case. */
export function getComparisonBaseline(currency: string): ComparisonBaseline | null {
  return BASELINES[currency] ?? null;
}

/** Category cost in USD for a given send amount, from the baseline shape. */
export function baselineCostUsd(baseline: CategoryBaseline, amountUsd: number): number {
  return amountUsd * (baseline.pct / 100) + baseline.flatUsd;
}
