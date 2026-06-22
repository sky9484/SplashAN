import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FundingRegistryError,
  getEnabledFundingOptions,
  resolveFundingSelection,
  suggestedUsdProvider,
} from '../lib/funding/registry.ts';

const baseEnv = {
  FEATURE_DUAL_FUNDING: 'true',
  USE_MOCK_APIS: 'true',
  FUNDING_ASSET_USDC_ENABLED: 'true',
  FUNDING_ASSET_USDSUI_ENABLED: 'true',
  FUNDING_ASSET_USDT_ENABLED: 'false',
  USDC_TYPE: '0x1::usdc::USDC',
  USDSUI_TYPE: '0x2::usdsui::USDSUI',
  USDT_TYPE: '0x3::usdt::USDT',
};

test('disabled stablecoins are omitted and rejected server-side', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  assert.deepEqual(registry.stablecoinAssets.map((asset) => asset.symbol), ['USDC', 'USDSUI']);
  assert.throws(
    () => resolveFundingSelection({ method: 'STABLECOIN', asset: 'USDT', rail: 'SUI_NATIVE', feeTier: 'DISCOUNT' }, baseEnv),
    FundingRegistryError,
  );
});

test('asset and rail combinations are hard-rejected', () => {
  assert.throws(
    () => resolveFundingSelection({ method: 'STABLECOIN', asset: 'USDSUI', rail: 'CCTP', sourceChain: 'BASE', feeTier: 'DISCOUNT' }, baseEnv),
    /not enabled/,
  );
  assert.throws(
    () => resolveFundingSelection({ method: 'STABLECOIN', asset: 'USDC', rail: 'CCTP', feeTier: 'DISCOUNT' }, baseEnv),
    /source chain/,
  );
});

test('USDT only appears when the flag and coin type are present', () => {
  const registry = getEnabledFundingOptions({ ...baseEnv, FUNDING_ASSET_USDT_ENABLED: 'true' });
  assert.equal(registry.stablecoinAssets.at(-1)?.symbol, 'USDT');
});

test('Malaysia suggests Airwallex and other regions suggest Stripe', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  assert.equal(suggestedUsdProvider('MY', registry), 'AIRWALLEX');
  assert.equal(suggestedUsdProvider('SG', registry), 'STRIPE');
});
