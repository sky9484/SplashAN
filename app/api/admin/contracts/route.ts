import { NextResponse } from 'next/server';

import { getAdminSession } from '@/lib/server/admin-auth';
import {
  CONTRACT_CONFIG_FIELDS,
  type ContractConfig,
  type ContractConfigField,
  getContractConfig,
  getContractConfigMeta,
  getEnvKeyFor,
  saveContractConfig,
  validateContractConfig,
} from '@/lib/server/contract-config';
import { readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

function envOnlyView() {
  const result: Record<ContractConfigField, string> = {} as Record<ContractConfigField, string>;
  for (const field of CONTRACT_CONFIG_FIELDS) {
    result[field] = (process.env[getEnvKeyFor(field)] ?? '').trim();
  }
  return result;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  const config = getContractConfig();
  return NextResponse.json({
    config,
    env: envOnlyView(),
    envKeys: Object.fromEntries(CONTRACT_CONFIG_FIELDS.map((f) => [f, getEnvKeyFor(f)])),
    meta: getContractConfigMeta(),
    network: process.env.SUI_NETWORK ?? 'testnet',
  });
}

export async function PUT(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  const body = await readJsonBody(request);

  const input = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) as Partial<ContractConfig>;
  const sanitized: Partial<ContractConfig> = {};
  for (const field of CONTRACT_CONFIG_FIELDS) {
    const value = input[field];
    if (typeof value === 'string') sanitized[field] = value.trim();
  }

  const check = validateContractConfig(sanitized);
  if (!check.ok) {
    return NextResponse.json({ error: 'Invalid contract config', fields: check.errors }, { status: 400 });
  }

  try {
    const updated = saveContractConfig(sanitized);
    return NextResponse.json({
      config: updated,
      meta: getContractConfigMeta(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save contract config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
