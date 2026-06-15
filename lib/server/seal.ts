import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type SealPolicy = { policyId: string; allowlist: string[]; createdAt: string };
export interface SealAdapter {
  encrypt(data: string, allowlist: string[]): Promise<{ ciphertext: string; policy: SealPolicy }>;
  canDecrypt(policyId: string, identity: string): Promise<boolean>;
  decrypt(ciphertext: string, policyId: string, identity: string): Promise<string | null>;
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

const globalPolicies = globalThis as typeof globalThis & { splashSealPolicies?: Map<string, SealPolicy> };
const policies = globalPolicies.splashSealPolicies ?? new Map<string, SealPolicy>();
globalPolicies.splashSealPolicies = policies;

function secretKey() {
  return createHash('sha256').update(process.env.ADMIN_SESSION_SECRET || 'splash-seal-mock-development-key').digest();
}

function normalizedAllowlist(allowlist: string[]) {
  return [...new Set(allowlist.map((identity) => identity.trim().toLowerCase()).filter(Boolean))].sort();
}

export const mockSealAdapter: SealAdapter = {
  async encrypt(data, allowlist) {
    const createdAt = new Date().toISOString();
    const normalized = normalizedAllowlist(allowlist);
    const policyId = `seal_${createHash('sha256').update(`${normalized.join('|')}:${createdAt}`).digest('hex').slice(0, 16)}`;
    const policy = { policyId, allowlist: normalized, createdAt };
    policies.set(policyId, policy);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([iv, tag, encrypted]).toString('base64'),
      policy,
    };
  },
  async canDecrypt(policyId, identity) {
    return policies.get(policyId)?.allowlist.includes(identity.trim().toLowerCase()) ?? false;
  },
  async decrypt(ciphertext, policyId, identity) {
    if (!(await this.canDecrypt(policyId, identity))) return null;
    const payload = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  },
};

export const liveSealAdapter: SealAdapter = {
  async encrypt() {
    throw new NotConfiguredError('Live Seal threshold encryption is not configured for this environment.');
  },
  async canDecrypt() {
    throw new NotConfiguredError('Live Seal access checks are not configured for this environment.');
  },
  async decrypt() {
    throw new NotConfiguredError('Live Seal decryption is not configured for this environment.');
  },
};

export const sealAdapter =
  process.env.USE_MOCK_APIS === 'true' || !process.env.SEAL_KEY_SERVER_URLS ? mockSealAdapter : liveSealAdapter;

export function readSealPolicy(policyId: string) {
  return policies.get(policyId) ?? null;
}
