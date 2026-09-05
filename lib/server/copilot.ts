/**
 * 0xWal — layered copilot intelligence.
 *
 * Real implementations (no placeholders): grounded in corridor data, MemWal
 * behavioral memory, and the floating USDY treasury rate. Claude is used where
 * it adds value (invoice extraction) but every function degrades gracefully
 * without ANTHROPIC_API_KEY. RULE: the copilot only SUGGESTS — the user must
 * authorize execution. Never invents PII/account numbers.
 */

import { getCorridorFeeBps, getUsdCorridorByCurrency } from '@/lib/fx/corridors';
import { recallMemories, analyzeAndRemember } from '@/lib/server/memwal';
import { getTreasuryRate } from '@/lib/server/usdy';
import { pythAdapter } from '@/lib/server/pyth';

export interface CopilotSuggestion {
  suggestionId: string;
  type: 'timing' | 'batch' | 'treasury' | 'invoice';
  title: string;
  description: string;
  confidence: number;
  requiresAuth: boolean;
  suggestedAction?: string;
}

const SUPPORTED = ['PHP', 'MYR', 'IDR', 'VND', 'THB', 'SGD', 'EUR', 'GBP'];

// ─── Invoice parsing (Claude when available, heuristic otherwise) ───────────────

export async function parseInvoice(
  invoiceText: string,
): Promise<{ amount: number; currency: string; recipient: string; confidence: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const resp = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        max_tokens: 300,
        system:
          'Extract the payable amount, ISO-4217 currency, and recipient/vendor name from this invoice. ' +
          'Respond ONLY with compact JSON: {"amount":number,"currency":"XXX","recipient":"..."}. No prose.',
        messages: [{ role: 'user', content: invoiceText.slice(0, 6000) }],
      });
      const text = resp.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
        amount: number; currency: string; recipient: string;
      };
      // Remember the behavioral pattern (vendor + currency), never the raw doc.
      void analyzeAndRemember(`Invoice vendor ${json.recipient} settles in ${json.currency}`);
      return { amount: Number(json.amount) || 0, currency: String(json.currency || 'USD').toUpperCase(), recipient: String(json.recipient || ''), confidence: 0.9 };
    } catch {
      // fall through to heuristic
    }
  }
  // Heuristic fallback — regex extraction.
  const amountMatch = invoiceText.match(/(?:total|amount due|balance)\D{0,12}([\d,]+\.?\d{0,2})/i) ?? invoiceText.match(/([\d,]+\.\d{2})/);
  const currencyMatch = invoiceText.match(/\b(USD|PHP|MYR|IDR|VND|THB|SGD|EUR|GBP)\b/i);
  const recipientMatch = invoiceText.match(/(?:bill to|vendor|from|pay to)\s*:?\s*([A-Z][\w .,&-]{2,40})/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  const currency = (currencyMatch?.[1] ?? 'USD').toUpperCase();
  const recipient = recipientMatch?.[1]?.trim() ?? '';
  if (recipient) void analyzeAndRemember(`Invoice vendor ${recipient} settles in ${currency}`);
  return { amount, currency, recipient, confidence: amount > 0 ? 0.55 : 0.2 };
}

// ─── FX forecast (grounded in the live corridor rate) ───────────────────────────

export async function forecastFxRate(
  corridor: string,
  horizonHours: number,
): Promise<{ predictedRate: number; confidence: number; currentRate: number; note: string }> {
  const currency = corridor.replace(/^USD[\/→-]?/i, '').toUpperCase().slice(0, 3);
  const current = getUsdCorridorByCurrency(currency)?.rate ?? 1;

  // Every corridor settles via USDC, so USDC peg health (Pyth) is a real
  // confidence signal: a tight peg = more reliable quotes; a stressed peg = less.
  let pegFactor = 1;
  let pegNote = '';
  try {
    const peg = await pythAdapter.getPegStatus();
    const usdcDevBps = Math.abs(peg.usdcUsd.price - 1) * 10_000;
    pegFactor = peg.pegged ? Math.max(0.85, 1 - usdcDevBps / 100) : 0.7;
    pegNote = peg.pegged
      ? `USDC peg healthy (${usdcDevBps.toFixed(1)} bps, Pyth)`
      : 'USDC peg under stress (Pyth) — settle cautiously';
  } catch {
    // Pyth unavailable — fall back to horizon-only confidence.
  }

  // Confidence decays with horizon; we don't pretend to predict direction.
  const horizonDecay = Math.max(0.4, 0.95 - (Math.min(horizonHours, 168) / 168) * 0.45);
  const confidence = Number((horizonDecay * pegFactor).toFixed(2));
  const note = SUPPORTED.includes(currency)
    ? `USD→${currency} is ${current}.${pegNote ? ` ${pegNote}.` : ''} Over ${horizonHours}h expect normal drift; lock during pre-open liquidity for the tightest spread.`
    : `USD→${currency} is not an active corridor.`;
  return { predictedRate: current, confidence, currentRate: current, note };
}

// ─── Batch optimizer (group same-corridor rows; real fee math) ──────────────────

export async function optimizeBatch(
  rows: Array<{ amount: number; corridor: string }>,
): Promise<{ suggestedGrouping: number[][]; savingsEstimateUsd: number; byCorridor: Record<string, number> }> {
  const groups: Record<string, number[]> = {};
  const byCorridor: Record<string, number> = {};
  rows.forEach((row, i) => {
    const currency = row.corridor.replace(/^USD[\/→-]?/i, '').toUpperCase().slice(0, 3);
    (groups[currency] ??= []).push(i);
    byCorridor[currency] = (byCorridor[currency] ?? 0) + row.amount;
  });
  // Savings: batching nets one quote per corridor instead of paying spread per
  // row. Approximate the saved spread as ~6 bps per row collapsed into a group.
  const SAVED_BPS_PER_COLLAPSED_ROW = Number(process.env.BATCH_SAVED_BPS_PER_ROW ?? 6);
  let savings = 0;
  for (const [currency, idxs] of Object.entries(groups)) {
    if (idxs.length < 2) continue;
    const feeBps = getCorridorFeeBps(currency);
    const groupTotal = idxs.reduce((s, i) => s + rows[i].amount, 0);
    // collapsing (n-1) rows of spread; scaled by the corridor's fee weight.
    savings += (groupTotal * (SAVED_BPS_PER_COLLAPSED_ROW / 10_000)) * ((idxs.length - 1) / idxs.length) * Math.max(0.5, feeBps / 100);
  }
  return {
    suggestedGrouping: Object.values(groups),
    savingsEstimateUsd: Math.round(savings * 100) / 100,
    byCorridor,
  };
}

// ─── Treasury advice (live two-bucket balances + floating rate) ─────────────────

export async function suggestTreasuryAction(
  currentAvailableUsd: number,
  pendingOutflowsUsd: number,
): Promise<CopilotSuggestion> {
  const rate = getTreasuryRate();
  const buffer = Number(process.env.OPERATING_BUFFER_USD ?? 5_000);
  const idle = Math.max(0, currentAvailableUsd - pendingOutflowsUsd - buffer);
  const dailyOnIdle = (idle * (rate.netApyPct / 100)) / 365;
  if (idle < 1_000) {
    return {
      suggestionId: `cop_${Date.now()}`,
      type: 'treasury',
      title: 'Available balance is working efficiently',
      description: `Your Available cash is close to the operating buffer ($${buffer.toLocaleString('en-US')}). Nothing idle to move right now.`,
      confidence: 0.7,
      requiresAuth: false,
    };
  }
  return {
    suggestionId: `cop_${Date.now()}`,
    type: 'treasury',
    title: `Move ~$${Math.round(idle).toLocaleString('en-US')} idle USDC into Smart Treasury`,
    description:
      `After a $${buffer.toLocaleString('en-US')} operating buffer and $${Math.round(pendingOutflowsUsd).toLocaleString('en-US')} pending outflows, ` +
      `~$${Math.round(idle).toLocaleString('en-US')} is idle. At ${rate.label} (Ondo USDY, T-bill) that earns ≈$${dailyOnIdle.toFixed(2)}/day. ` +
      `Withdrawals back to Available take 1–3 business days.`,
    confidence: 0.82,
    requiresAuth: true,
    suggestedAction: `move:${Math.round(idle)}:available->treasury`,
  };
}

// ─── Personalized suggestions from MemWal behavioral memory ─────────────────────

export async function getCopilotSuggestions(userIdHash: string): Promise<CopilotSuggestion[]> {
  const out: CopilotSuggestion[] = [];
  try {
    const memories = await recallMemories(userIdHash || 'patterns', 6);
    for (const m of memories) {
      const text = m.text.toLowerCase();
      const ccy = SUPPORTED.find((c) => text.includes(c.toLowerCase()));
      if (text.includes('batch') || text.includes('payroll')) {
        out.push({
          suggestionId: `cop_${Date.now()}_${out.length}`,
          type: 'batch',
          title: 'Pre-stage your recurring batch',
          description: `Pattern recalled: “${m.text}”. Want me to draft it on the cheapest corridor and lock during pre-open liquidity?`,
          confidence: Math.max(0.6, 1 - m.distance),
          requiresAuth: true,
        });
      } else if (ccy) {
        out.push({
          suggestionId: `cop_${Date.now()}_${out.length}`,
          type: 'timing',
          title: `Watch USD→${ccy}`,
          description: `Pattern recalled: “${m.text}”. I'll flag the optimal lock window for ${ccy}.`,
          confidence: Math.max(0.55, 1 - m.distance),
          requiresAuth: false,
        });
      }
    }
  } catch {
    // memory unavailable — return defaults below
  }
  if (out.length === 0) {
    const rate = getTreasuryRate();
    out.push({
      suggestionId: `cop_${Date.now()}`,
      type: 'treasury',
      title: 'Put idle USDC to work',
      description: `Idle Available cash earns 0%. Smart Treasury (Ondo USDY, T-bill) is ${rate.label}. Move some over?`,
      confidence: 0.6,
      requiresAuth: true,
    });
  }
  return out.slice(0, 5);
}
