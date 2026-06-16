import fs from 'node:fs';
import path from 'node:path';

export type ContractConfigField =
  | 'packageId'
  | 'treasuryId'
  | 'adminCapId'
  | 'pegStateId'
  | 'businessAccountId'
  | 'transferCoinId'
  | 'settlementRegistryId'
  | 'testRecipientAddress'
  | 'operatorAddress'
  | 'treasuryAddress'
  | 'usdcType'
  | 'usdtType'
  | 'usdtBufferId'
  | 'usdyType'
  | 'smartTreasurySuiId'
  | 'usdcTreasuryId'
  | 'usdyTreasuryId';

export type ContractConfig = Record<ContractConfigField, string>;

const FIELD_TO_ENV: Record<ContractConfigField, string> = {
  packageId: 'SPLASH_PACKAGE_ID',
  treasuryId: 'SPLASH_TREASURY_ID',
  adminCapId: 'SPLASH_ADMIN_CAP_ID',
  pegStateId: 'SPLASH_PEG_STATE_ID',
  businessAccountId: 'SPLASH_BUSINESS_ACCOUNT_ID',
  transferCoinId: 'SPLASH_TRANSFER_COIN_ID',
  settlementRegistryId: 'SPLASH_SETTLEMENT_REGISTRY_ID',
  testRecipientAddress: 'SPLASH_TEST_RECIPIENT_ADDRESS',
  operatorAddress: 'OPERATOR_SUI_ADDRESS',
  treasuryAddress: 'TREASURY_ADDRESS',
  usdcType: 'USDC_TYPE',
  usdtType: 'USDT_TYPE',
  usdtBufferId: 'USDT_BUFFER_ID',
  usdyType: 'USDY_TYPE',
  smartTreasurySuiId: 'SPLASH_SMART_TREASURY_SUI_ID',
  usdcTreasuryId: 'SPLASH_USDC_TREASURY_ID',
  usdyTreasuryId: 'SPLASH_USDY_TREASURY_ID',
};

export const CONTRACT_CONFIG_FIELDS = Object.keys(FIELD_TO_ENV) as ContractConfigField[];

const DATA_DIR = process.env.SPLASH_DATA_DIR ?? path.join(process.cwd(), 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'contract-config.json');

type Cached = { config: ContractConfig; mtimeMs: number; readAt: number };
let cached: Cached | null = null;

function envFallback(): ContractConfig {
  const out = {} as ContractConfig;
  for (const field of CONTRACT_CONFIG_FIELDS) {
    out[field] = (process.env[FIELD_TO_ENV[field]] ?? '').trim();
  }
  return out;
}

function readFileConfig(): Partial<ContractConfig> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<ContractConfig> = {};
    for (const field of CONTRACT_CONFIG_FIELDS) {
      const value = parsed[field];
      if (typeof value === 'string' && value.trim()) {
        out[field] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getContractConfig(): ContractConfig {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.config;
  }

  const merged: ContractConfig = { ...envFallback(), ...readFileConfig() };
  cached = { config: merged, mtimeMs, readAt: Date.now() };
  return merged;
}

export function getContractConfigMeta() {
  let mtimeMs: number | null = null;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    mtimeMs = null;
  }
  return {
    path: CONFIG_PATH,
    exists: mtimeMs !== null,
    updatedAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
  };
}

function isObjectIdLike(value: string) {
  return /^0x[a-fA-F0-9]{1,64}$/.test(value);
}

function isCanonicalObjectId(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isMoveTypeLike(value: string) {
  return /^0x[a-fA-F0-9]+::[a-zA-Z_][\w]*::[a-zA-Z_][\w<>:,\s]*$/.test(value);
}

const ID_FIELDS: ContractConfigField[] = [
  'packageId',
  'treasuryId',
  'adminCapId',
  'pegStateId',
  'businessAccountId',
  'transferCoinId',
  'settlementRegistryId',
  'smartTreasurySuiId',
  'usdcTreasuryId',
  'usdyTreasuryId',
];

const ADDRESS_FIELDS: ContractConfigField[] = [
  'testRecipientAddress',
  'operatorAddress',
  'treasuryAddress',
];

const MOVE_TYPE_FIELDS: ContractConfigField[] = ['usdcType', 'usdtType', 'usdyType'];

export function validateContractConfig(input: Partial<ContractConfig>): { ok: true } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const field of ID_FIELDS) {
    const value = (input[field] ?? '').trim();
    if (!value) continue;
    if (!isObjectIdLike(value)) {
      errors[field] = 'Must be a Sui object/package ID starting with 0x (hex).';
    } else if (field === 'packageId' && !isCanonicalObjectId(value)) {
      errors[field] = 'Package ID must be 0x + 64 hex characters.';
    }
  }

  for (const field of ADDRESS_FIELDS) {
    const value = (input[field] ?? '').trim();
    if (!value) continue;
    if (!isCanonicalObjectId(value)) {
      errors[field] = 'Must be a 32-byte Sui address (0x + 64 hex characters).';
    }
  }

  for (const field of MOVE_TYPE_FIELDS) {
    const value = (input[field] ?? '').trim();
    if (!value) continue;
    if (!isMoveTypeLike(value)) {
      errors[field] = 'Must be a Move type, e.g. 0xpkg::module::TYPE.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export function saveContractConfig(input: Partial<ContractConfig>): ContractConfig {
  const trimmed: Partial<ContractConfig> = {};
  for (const field of CONTRACT_CONFIG_FIELDS) {
    const value = (input[field] ?? '').trim();
    if (value) trimmed[field] = value;
  }

  const check = validateContractConfig(trimmed);
  if (!check.ok) {
    const message = Object.entries(check.errors).map(([k, v]) => `${k}: ${v}`).join('; ');
    throw new Error(`Invalid contract config — ${message}`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);

  cached = null;
  return getContractConfig();
}

export function getEnvKeyFor(field: ContractConfigField): string {
  return FIELD_TO_ENV[field];
}
