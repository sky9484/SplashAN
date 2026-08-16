#!/usr/bin/env node
/**
 * THE CORE INVARIANT — splash_core cannot hold client funds.
 *
 * Splash operates under Labuan MFCA and is not licensed to hold client money.
 * The weak way to honour that is a runtime gate: a `LicenceState` object and an
 * `assert_custody_permitted` in every custodial function. That works until
 * someone forgets the assert, or flips the tier, and it forces an auditor to
 * trace every call site before they can believe the claim.
 *
 * The strong way — the one this script enforces — is that the published package
 * contains NO STRUCT FIELD CAPABLE OF HOLDING VALUE. Not gated. Absent. Client
 * value exists only as a `Coin<T>` parameter that enters and exits
 * `confirm_payment_intent` within a single PTB; there is no object to
 * accumulate into.
 *
 * "How do I know Splash cannot hold my money?" stops being a twelve-minute
 * walkthrough that ends in "trust us" and becomes a twelve-second grep.
 *
 * This script is that grep, run on every build. If it ever fails, the answer is
 * NOT to add an exception here — it is to move the offending struct to
 * splash_custody, which publishes only when the e-money licence lands.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const CORE_SOURCES = path.join('move', 'splash_core', 'sources');

/**
 * Shapes that let a struct ACCUMULATE value across transactions.
 *
 * The distinction that matters is stored-vs-passed. `Coin<T>` as a function
 * PARAMETER is fine and is how the non-custodial path works — the coin arrives,
 * is split, and leaves in the same PTB. `Coin<T>` as a struct FIELD is custody,
 * because the object outlives the transaction.
 */
const FORBIDDEN = [
  {
    // `balance: Balance<T>` — the canonical custody field.
    pattern: /^\s*(?:pub\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*Balance\s*</,
    what: 'a `Balance<T>` struct field',
    why: 'a Balance accumulates value across transactions — that is custody',
  },
  {
    // `treasury: Coin<T>` — a stored Coin outlives the PTB.
    pattern: /^\s*(?:pub\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*Coin\s*</,
    what: 'a stored `Coin<T>` struct field',
    why: 'a Coin passed as a parameter is fine; a Coin STORED in a struct outlives the transaction and is custody',
  },
  {
    // Minting authority is not custody, but it is value creation and does not
    // belong in a package that claims to be a pure orchestration layer.
    pattern: /^\s*(?:pub\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*TreasuryCap\s*</,
    what: 'a stored `TreasuryCap<T>`',
    why: 'mint authority does not belong in the non-custodial core package',
  },
];

/** Lines that are comments or inside a doc block are documentation, not code. */
function isProse(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('///') || trimmed.startsWith('*');
}

async function main() {
  let files;
  try {
    files = (await readdir(CORE_SOURCES)).filter((f) => f.endsWith('.move'));
  } catch {
    console.error(`FAIL: ${CORE_SOURCES} does not exist. The splash_core package is the mainnet package — it cannot be missing.`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`FAIL: ${CORE_SOURCES} contains no .move files.`);
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const full = path.join(CORE_SOURCES, file);
    const lines = (await readFile(full, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isProse(line)) return;
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line)) {
          violations.push({ file: full, line: index + 1, text: line.trim(), rule });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error('\n  CORE INVARIANT VIOLATED — splash_core must hold no client value.\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.text}`);
      console.error(`    -> ${v.rule.what}: ${v.rule.why}\n`);
    }
    console.error('  splash_core publishes to mainnet under the Labuan MFCA licence, which does');
    console.error('  NOT permit holding client funds. Move this struct to move/splash_custody,');
    console.error('  which publishes only when the e-money licence is granted.\n');
    console.error('  Do not add an exception to this script. The grep returning nothing IS the');
    console.error('  regulatory claim.\n');
    process.exit(1);
  }

  console.log(`Core invariant holds: no value-bearing field in ${files.length} splash_core modules.`);
}

await main();
