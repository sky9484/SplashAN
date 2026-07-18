/**
 * W9.4 — "Where your money sits" trust panel content.
 *
 * ONE config drives every mount of components/compliance/MoneyPathPanel.tsx
 * (treasury, funding flow, receipt verify link) so partner names and license
 * status update in exactly one place.
 *
 * CLAIMS RULES:
 * - `REQUIRED_HONESTY_SENTENCE` is locked copy and may NOT be paraphrased;
 *   scripts/check-copy.mjs fails the build if it disappears from this file.
 * - Partner names here are partners of record — never add a partner that has
 *   not signed, and never upgrade the license language without 0xSky.
 */

export const MONEY_PATH_HEADER = 'Splash orchestrates — we never hold your funds.';

export const REQUIRED_HONESTY_SENTENCE =
  'Labuan FSA license in process. Splash is not yet a licensed money-services business.';

export type MoneyPathStep = {
  /** Partner of record (or Splash itself for the orchestration step). */
  partner: string;
  /** What this hop does with the money, in operator language. */
  role: string;
  /** One-line detail below the role. */
  detail: string;
};

/** PHP payout rails — render the ACTIVE one. When the Coins.ph rail goes
 *  live, flip `active` here and every mount updates. */
export const PH_PAYOUT_RAILS = [
  { name: 'PDAX · via GCash', active: true },
  { name: 'Coins.ph', active: false },
] as const;

const activePhRail = PH_PAYOUT_RAILS.find((rail) => rail.active) ?? PH_PAYOUT_RAILS[0];

export const MONEY_PATH_STEPS: MoneyPathStep[] = [
  {
    partner: 'Airwallex',
    role: 'Collection',
    detail: 'Your USD arrives into partner-held accounts.',
  },
  {
    partner: 'Hata',
    role: 'Conversion',
    detail: 'Regulated venue converts at the quoted rate.',
  },
  {
    partner: activePhRail.name,
    role: 'PHP payout',
    detail: 'Licensed local rail delivers to your supplier.',
  },
  {
    partner: 'Splash',
    role: 'Orchestrates and proves',
    detail: REQUIRED_HONESTY_SENTENCE,
  },
];
