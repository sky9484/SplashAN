/**
 * Walrus stores ciphertext only. Plaintext PII, bank details, and KYC data must
 * never be sent to the publisher.
 */
import { createHash } from 'node:crypto';

import { findAuditReceiptByHash, updateAuditReceipt } from '@/lib/server/operations';

export interface WalrusBlob {
  blobId: string;
  encryptedData: string;
  sizeBytes: number;
  epochs: number;
  mode: 'mock' | 'live';
  createdAt: string;
}

export class WalrusAdapterError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = 'WalrusAdapterError';
  }
}

const globalBlobs = globalThis as typeof globalThis & { splashWalrusBlobs?: Map<string, WalrusBlob> };
const blobs = globalBlobs.splashWalrusBlobs ?? new Map<string, WalrusBlob>();
globalBlobs.splashWalrusBlobs = blobs;

function assertCiphertextOnly(payload: string) {
  const normalized = payload.trim().toLowerCase();
  if (
    (normalized.startsWith('{') || normalized.startsWith('[')) &&
    /"(account|swift|nric)"\s*:/.test(normalized)
  ) {
    throw new WalrusAdapterError('Walrus rejected a plaintext payload containing an obvious PII key.', 400);
  }
}

function mockMode() {
  return process.env.USE_MOCK_APIS === 'true' || !process.env.WALRUS_PUBLISHER_URL;
}

export async function storeEncryptedInvoice(encryptedData: string): Promise<WalrusBlob> {
  assertCiphertextOnly(encryptedData);
  if (mockMode()) {
    const blobId = `wal_mock_${createHash('sha256').update(encryptedData).digest('hex').slice(0, 24)}`;
    const blob: WalrusBlob = {
      blobId,
      encryptedData,
      sizeBytes: Buffer.byteLength(encryptedData),
      epochs: 5,
      mode: 'mock',
      createdAt: new Date().toISOString(),
    };
    blobs.set(blobId, blob);
    return blob;
  }

  try {
    const response = await fetch(`${process.env.WALRUS_PUBLISHER_URL}/v1/blobs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: encryptedData,
    });
    if (!response.ok) throw new Error(`publisher returned ${response.status}`);
    const result = (await response.json()) as {
      newlyCreated?: { blobObject?: { blobId?: string }; blobId?: string };
      alreadyCertified?: { blobId?: string };
      blobId?: string;
    };
    const blobId =
      result.newlyCreated?.blobObject?.blobId ??
      result.newlyCreated?.blobId ??
      result.alreadyCertified?.blobId ??
      result.blobId;
    if (!blobId) throw new Error('publisher response did not include a blob ID');
    return {
      blobId,
      encryptedData,
      sizeBytes: Buffer.byteLength(encryptedData),
      epochs: 5,
      mode: 'live',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new WalrusAdapterError(`Walrus publish failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export async function retrieveBlob(blobId: string): Promise<WalrusBlob | null> {
  if (blobId.startsWith('wal_mock_') || mockMode()) return blobs.get(blobId) ?? null;
  const base = process.env.WALRUS_AGGREGATOR_URL;
  if (!base) throw new WalrusAdapterError('WALRUS_AGGREGATOR_URL is not configured.');
  try {
    const response = await fetch(`${base}/v1/blobs/${encodeURIComponent(blobId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`aggregator returned ${response.status}`);
    const encryptedData = await response.text();
    return {
      blobId,
      encryptedData,
      sizeBytes: Buffer.byteLength(encryptedData),
      epochs: 5,
      mode: 'live',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new WalrusAdapterError(`Walrus retrieval failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export async function anchorAuditHash(auditHash: string): Promise<{ anchorId: string; confirmed: boolean }> {
  const anchorId = `audit_${Date.now().toString(36)}_${auditHash.slice(0, 8)}`;
  const receipt = findAuditReceiptByHash(auditHash);
  if (receipt) updateAuditReceipt(receipt.transferIntentId, { auditAnchorId: anchorId });
  return { anchorId, confirmed: true };
}
