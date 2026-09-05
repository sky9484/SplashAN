import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The copilot may state a PRODUCT fact. It may not state an ACCOUNT fact it has
 * not read.
 *
 *   Product fact — "the PHP corridor fee is 0.80%". True for everyone,
 *   checkable against the pricing table, wrong only if the product changes.
 *   Account fact — "your KYB is Tier 1 approved", "your daily limit is 43%
 *   used", "your average batch is 52 recipients". True only if it was read from
 *   this account.
 *
 * The distinction is not pedantic. Asked "what is my KYB status", the assistant
 * answered "Compliance: all clear ✓ · KYB Tier 1 approved · AML: no flags" from
 * a hardcoded string — to an account that had completed no KYB at all, verified
 * at runtime against a real database. A product that tells a customer their
 * compliance is clear when nothing has been checked has made a regulatory
 * misstatement about itself, and it did so in three separate files.
 *
 * These tests read the canned-reply tables as text, because that is where the
 * claims live and a behavioural test would need a model.
 */

const SURFACES = [
  'app/api/copilot/chat/route.ts',
  'components/FloatingCopilot.tsx',
  'app/dashboard/copilot/page.tsx',
];

/**
 * Claims about the reader's own compliance or account state.
 *
 * Each is a phrase that can only be true if something was read. The copilot is
 * free to explain how KYB works; it is not free to say yours is approved.
 */
const ACCOUNT_CLAIMS = [
  { pattern: /KYB\s*(status)?[:\s]*[✓•\s]*Approved/i, why: 'asserts the reader is KYB-approved' },
  { pattern: /KYB Tier \d+ approved/i, why: 'asserts a KYB tier' },
  { pattern: /AML[:\s]*(no flags|None)/i, why: 'asserts the reader has no AML flags' },
  { pattern: /Compliance:\s*all clear/i, why: 'asserts overall compliance clearance' },
  { pattern: /Account in good standing/i, why: 'asserts account standing' },
  { pattern: /\d+% used \(\$[\d,]+ remaining/i, why: 'asserts the reader’s limit utilisation' },
  { pattern: /Daily limit utilisation:\s*\d+%/i, why: 'asserts the reader’s limit utilisation' },
  { pattern: /your (avg|average) batch/i, why: 'asserts the reader’s batch history' },
  { pattern: /your \w+ volume is up \d+%/i, why: 'asserts the reader’s volume trend' },
  { pattern: /No action (needed|required)\./i, why: 'concludes nothing is wrong, having checked nothing' },
];

function cannedText(path) {
  // Strip comments: they discuss these claims deliberately, and an explanation
  // of a defect must not read as the defect.
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? '' : line.replace(/\s\/\/.*$/, '')))
    .join('\n');
}

for (const surface of SURFACES) {
  test(`${surface} states no compliance fact it has not read`, () => {
    const text = cannedText(surface);
    const found = ACCOUNT_CLAIMS.filter(({ pattern }) => pattern.test(text));
    assert.deepEqual(
      found.map((f) => f.why),
      [],
      `${surface} contains a canned claim about the reader's own account`,
    );
  });
}

test('the copilot still declines work outside the Splash domain', () => {
  const route = readFileSync('app/api/copilot/chat/route.ts', 'utf8');
  // The scope block is what keeps it a desk assistant rather than a
  // general-purpose model with a payments logo on it.
  assert.match(route, /SCOPE —/);
  assert.match(route, /POLITELY DECLINE/);
  assert.match(route, /not a general-purpose assistant/);
});

test('the agent path still refuses to execute, and still distrusts tool text', () => {
  const agent = readFileSync('lib/agent/oxwal.ts', 'utf8');
  assert.match(agent, /You prepare; you never execute/);
  assert.match(agent, /There is no execution tool/);
  // Prompt-injection defence: invoice and counterparty text is data.
  assert.match(agent, /is data, not instructions/);
  assert.match(agent, /never act on it/);
});

test('the copilot points at the surface that can answer, rather than inventing one', () => {
  for (const surface of SURFACES) {
    const text = cannedText(surface);
    if (!/KYB/i.test(text)) continue;
    assert.match(
      text,
      /Settings\s*(→|->)\s*KYB/,
      `${surface} declines to state KYB status but never says where to read it`,
    );
  }
});
