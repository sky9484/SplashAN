import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildActionCardModel } from '../lib/agent/action-card.ts';

const now = '2026-07-01T00:00:00.000Z';

function sampleProposal(overrides = {}) {
  return {
    id: 'prop_frontend_1',
    kind: 'PAYMENT',
    status: 'PENDING_APPROVAL',
    tier: 'TIER_0_PROPOSE',
    orgId: 'demo-business',
    corridor: 'MY_PH',
    unsignedTxBytes: 'dW5zaWduZWQ=',
    createdBy: 'OXWAL',
    createdAt: now,
    expiresAt: '2026-07-01T00:15:00.000Z',
    approvals: [{ userId: 'approver-1', role: 'APPROVER', signedAt: now }],
    simulation: {
      ok: true,
      gasSponsored: true,
      simulatedAt: now,
      balanceChanges: [
        { owner: 'org_treasury', coinType: 'USDC', amount: '-5000000000' },
        { owner: 'cp_acme_ph', coinType: 'PHP', amount: '5000000000' },
      ],
    },
    explain: {
      recommendation: 'Prepare verified supplier payout',
      financialImpact: {
        amountOut: '5000000000',
        currencyOut: 'PHP',
        feeBps: 80,
        fxRate: { value: '56.4200', pythPriceId: 'pyth_usdc_usd', observedAt: now },
        nettingSaved: '125000',
      },
      evidence: [
        { source: 'COUNTERPARTY', ref: 'cp_acme_ph', observedAt: now, trusted: true },
        { source: 'INVOICE', ref: 'inv_demo_acme_5000', observedAt: now, trusted: false },
      ],
      confidence: 0.58,
      risk: 'HIGH',
      requiredApprovers: 2,
      reasoningTraceRef: 'walrus_reasoning_frontend',
    },
    ...overrides,
  };
}

test('ActionCard model exposes full proposal anatomy and trust treatment', () => {
  const model = buildActionCardModel(sampleProposal());

  assert.deepEqual(model.impactRows.map((row) => row.label), [
    'Amount in',
    'Amount out',
    'Fee',
    'FX',
    'Yield delta',
    'Netting saved',
  ]);
  assert.equal(model.simulationRows.some((row) => row.label === 'Dry-run' && row.value === 'Matched'), true);
  assert.equal(model.simulationRows.some((row) => row.label.includes('org_treasury')), true);
  assert.equal(model.evidenceRows.some((item) => item.trustLabel === 'Untrusted' && item.tone === 'untrusted'), true);
  assert.equal(model.confidencePercent, 58);
  assert.equal(model.riskTone, 'high');
  assert.equal(model.approverText, '1/2');
  assert.equal(model.primaryActionLabel, 'Sign & approve');
});

test('default dashboard is the streaming 0xWal surface and avoids browser money storage', async () => {
  const page = await readFile(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../app/dashboard/layout.tsx', import.meta.url), 'utf8');

  assert.match(page, /fetch\('\/api\/oxwal'/);
  assert.match(page, /response\.body\.getReader\(\)/);
  assert.match(page, /<ActionCard key=\{proposal\.id\} proposal=\{proposal\}/);
  assert.match(page, /href="\/queue"/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
  assert.match(layout, /label: '0xWal',\s+href: '\/dashboard'/);
  assert.match(layout, /href: '\/dashboard\/overview'/);
});

test('ActionCard component names release-gate sections and warning accent', async () => {
  const source = await readFile(new URL('../components/oxwal/ActionCard.tsx', import.meta.url), 'utf8');
  for (const label of [
    'Impact table',
    'Simulation deltas',
    'Evidence',
    'Confidence',
    'Approvers',
    'Reasoning trace',
    'Sign & approve',
    'Send for approval',
    'Reject',
    'Untrusted data',
  ]) {
    assert.equal(source.includes(label), true, `${label} should render in ActionCard`);
  }
  assert.match(source, /#E39774/);
});
