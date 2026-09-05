import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DEFAULT_COPILOT_MODEL, copilotModel } from '../lib/ai/model.ts';

/**
 * The model 0xWal actually runs on.
 *
 * The default was `claude-sonnet-4-6`, repeated in four files. That model id
 * does not exist. With an API key set, every call threw, was caught, and fell
 * back to the canned grounded responder — after the chat route had already
 * told the client `source: 'claude'`. The assistant never reached a model once,
 * and the UI said it had.
 */

test('the default is a real model id, and the lowest-cost one', () => {
  assert.equal(DEFAULT_COPILOT_MODEL, 'claude-haiku-4-5-20251001');
  // The shape that broke it: a version that was never published.
  assert.doesNotMatch(DEFAULT_COPILOT_MODEL, /sonnet-4-6/);
});

test('the environment can raise it without a deploy', () => {
  assert.equal(copilotModel({}), DEFAULT_COPILOT_MODEL);
  assert.equal(copilotModel({ ANTHROPIC_MODEL: 'claude-sonnet-5' }), 'claude-sonnet-5');
  // Blank is not a choice — an empty env var must not select an empty model.
  assert.equal(copilotModel({ ANTHROPIC_MODEL: '   ' }), DEFAULT_COPILOT_MODEL);
});

test('no file names a model id of its own', async () => {
  for (const file of [
    '../lib/agent/oxwal.ts',
    '../lib/server/copilot.ts',
    '../app/api/copilot/chat/route.ts',
    '../lib/env.ts',
  ]) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    // Four copies of a model id is how three of them stay wrong after the
    // fourth is fixed.
    assert.doesNotMatch(code, /['"]claude-[a-z0-9-]+['"]/, `${file} hardcodes a model id`);
    assert.match(code, /copilotModel\(\)|DEFAULT_COPILOT_MODEL/, `${file} must use the shared resolver`);
  }
});

test('the stream reports who answered, not who we hoped would', async () => {
  const route = await readFile(
    new URL('../app/api/copilot/chat/route.ts', import.meta.url),
    'utf8',
  );
  // The meta frame said `source: 'claude'` whenever a key was present — before
  // the call was made, and with a broken model id that claim was always false.
  assert.match(route, /attempting: apiKey \? 'claude' : 'grounded'/);
  assert.match(route, /send\(\{ type: 'done', source: answeredBy \}\)/);
  // Both fallback paths must correct it.
  const fallbacks = route.match(/answeredBy = 'grounded'/g) ?? [];
  assert.ok(fallbacks.length >= 2, 'every fallback path must record that it fell back');
});
