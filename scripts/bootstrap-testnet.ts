import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const packageId = required('SPLASH_PACKAGE_ID');
const adminCapId = required('SPLASH_ADMIN_CAP_ID');
const operatorAddress = required('OPERATOR_SUI_ADDRESS');
const privateKey = required('OPERATOR_SUI_PRIVATE_KEY');
const coinType = process.env.USDC_TYPE?.trim() || '0x2::sui::SUI';
const rpcUrl = process.env.SUI_RPC_URL?.trim() || 'https://fullnode.testnet.sui.io:443';

if (process.env.SUI_NETWORK !== 'testnet') {
  throw new Error('Bootstrap is intentionally limited to Sui testnet.');
}

const decoded = decodeSuiPrivateKey(privateKey);
if (decoded.scheme !== 'ED25519') {
  throw new Error(`Expected an ED25519 operator key, received ${decoded.scheme}.`);
}

const signer = Ed25519Keypair.fromSecretKey(decoded.secretKey);
if (signer.toSuiAddress().toLowerCase() !== operatorAddress.toLowerCase()) {
  throw new Error('OPERATOR_SUI_PRIVATE_KEY does not match OPERATOR_SUI_ADDRESS.');
}

const client = new SuiJsonRpcClient({ network: 'testnet', url: rpcUrl });
const tx = new Transaction();
tx.setGasBudget(Number(process.env.SUI_BOOTSTRAP_GAS_BUDGET ?? '50000000'));
tx.moveCall({
  target: `${packageId}::smart_treasury::init_treasury`,
  typeArguments: [coinType],
  arguments: [
    tx.object(adminCapId),
    tx.pure.string('splash-testnet-sui-reserve'),
    tx.object('0x6'),
  ],
});

const result = await client.signAndExecuteTransaction({
  signer,
  transaction: tx,
  options: {
    showEffects: true,
    showEvents: true,
    showObjectChanges: true,
  },
});

if (result.effects?.status?.status !== 'success') {
  throw new Error(result.effects?.status?.error ?? 'SmartTreasury bootstrap failed.');
}

const objectType = `${packageId}::smart_treasury::SmartTreasury<${coinType}>`;
const treasury = result.objectChanges?.find(
  (change) => change.type === 'created' && 'objectType' in change && change.objectType === objectType,
);

if (!treasury || !('objectId' in treasury)) {
  throw new Error(`Transaction succeeded but did not create ${objectType}. Digest: ${result.digest}`);
}

console.log(JSON.stringify({
  digest: result.digest,
  smartTreasurySuiId: treasury.objectId,
  objectType,
}, null, 2));
