import type { KeyServerConfig } from '@mysten/seal';

export type SealKeyServerMode = 'decentralized' | 'independent';

export type ParsedSealConfig = {
  configured: boolean;
  mode: SealKeyServerMode;
  serverConfigs: KeyServerConfig[];
  threshold: number;
  timeoutMs: number;
  packageId: string;
  policyObjectId: string;
  approveTarget: string;
};

const OBJECT_ID = /^0x[a-fA-F0-9]{64}$/;

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    if (value?.trim()) throw new Error(`${name} must be a positive integer.`);
    return fallback;
  }
  return parsed;
}

function parseJsonEndpoints(raw: string): KeyServerConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('SEAL_KEY_SERVER_ENDPOINTS JSON must be an array.');

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`SEAL_KEY_SERVER_ENDPOINTS[${index}] must be an object.`);
    }
    const value = entry as Record<string, unknown>;
    return {
      objectId: String(value.objectId ?? '').trim(),
      aggregatorUrl: value.aggregatorUrl ? String(value.aggregatorUrl).trim() : undefined,
      weight: Number(value.weight ?? 1),
    };
  });
}

function parseCompactEndpoints(raw: string): KeyServerConfig[] {
  return raw.split(',').map((entry) => {
    const [objectId = '', aggregatorUrl = '', weight = '1'] = entry.split('|').map((part) => part.trim());
    return {
      objectId,
      aggregatorUrl: aggregatorUrl || undefined,
      weight: Number.parseInt(weight, 10),
    };
  });
}

export function parseSealServerConfigs(raw: string, mode: SealKeyServerMode): KeyServerConfig[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const configs = trimmed.startsWith('[')
    ? parseJsonEndpoints(trimmed)
    : parseCompactEndpoints(trimmed);
  const ids = new Set<string>();

  for (const config of configs) {
    if (!OBJECT_ID.test(config.objectId)) {
      throw new Error(`Invalid Seal key-server object ID: ${config.objectId || '(blank)'}.`);
    }
    if (!Number.isInteger(config.weight) || config.weight < 1) {
      throw new Error(`Seal key-server weight for ${config.objectId} must be a positive integer.`);
    }
    if (ids.has(config.objectId.toLowerCase())) {
      throw new Error(`Duplicate Seal key-server object ID: ${config.objectId}.`);
    }
    ids.add(config.objectId.toLowerCase());

    if (mode === 'decentralized' && !config.aggregatorUrl) {
      throw new Error(`Decentralized Seal server ${config.objectId} requires an aggregatorUrl.`);
    }
    if (config.aggregatorUrl) {
      const url = new URL(config.aggregatorUrl);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new Error(`Seal aggregator URL must use HTTPS: ${config.aggregatorUrl}.`);
      }
      config.aggregatorUrl = url.toString().replace(/\/$/, '');
    }
  }

  return configs;
}

export function getSealConfig(env: NodeJS.ProcessEnv = process.env): ParsedSealConfig {
  const rawMode = (env.SEAL_KEY_SERVER_MODE ?? 'decentralized').trim().toLowerCase();
  if (rawMode !== 'decentralized' && rawMode !== 'independent') {
    throw new Error('SEAL_KEY_SERVER_MODE must be decentralized or independent.');
  }
  const mode: SealKeyServerMode = rawMode;
  const endpoints = env.SEAL_KEY_SERVER_ENDPOINTS ?? env.SEAL_KEY_SERVER_URLS ?? '';
  const serverConfigs = parseSealServerConfigs(endpoints, mode);
  const threshold = positiveInteger(env.SEAL_THRESHOLD, 1, 'SEAL_THRESHOLD');
  const totalWeight = serverConfigs.reduce((sum, server) => sum + server.weight, 0);
  if (serverConfigs.length > 0 && threshold > totalWeight) {
    throw new Error(`SEAL_THRESHOLD=${threshold} is not satisfiable by configured weight ${totalWeight}.`);
  }

  const packageId = (env.SEAL_PACKAGE_ID ?? '').trim();
  const policyObjectId = (env.SEAL_POLICY_OBJECT_ID ?? '').trim();
  if (packageId && !OBJECT_ID.test(packageId)) throw new Error('SEAL_PACKAGE_ID must be a canonical Sui package ID.');
  if (policyObjectId && !OBJECT_ID.test(policyObjectId)) {
    throw new Error('SEAL_POLICY_OBJECT_ID must be a canonical Sui object ID.');
  }

  return {
    configured: serverConfigs.length > 0 && Boolean(packageId && policyObjectId),
    mode,
    serverConfigs,
    threshold,
    timeoutMs: positiveInteger(env.SEAL_HEALTH_TIMEOUT_MS, 10_000, 'SEAL_HEALTH_TIMEOUT_MS'),
    packageId,
    policyObjectId,
    approveTarget: (env.SEAL_APPROVE_TARGET ?? (packageId ? `${packageId}::allowlist::seal_approve` : '')).trim(),
  };
}
