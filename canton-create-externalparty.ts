/**
 * Create a Canton external party with Institutional Vault signing.
 *
 * Flow:
 *   1. createKey / getKeys on Vault (`/api/cwp/canton`)
 *   2. generate-topology on the participant JSON Ledger API
 *   3. signTransaction on Vault (topology multiHash)
 *   4. allocate on the participant
 *
 * Required env: IV_API_BASE_URL, IV_API_KEY, IV_INITIATOR_ID,
 * LEDGER_CLIENT_URL, CANTON_AUTH_* (see .env-example).
 */

import { SDK, type TokenProviderConfig } from '@canton-network/wallet-sdk';
import {
  OpenAPI,
  KeysService,
  SigningService,
  SigningStatus,
  type Key,
} from './iv-sdk-canton-signing';
import { env, requireEnv } from './lib/env';

const MASTER_KEY = env('MASTER_KEY', 'Default');
const CAIP2 = env('CANTON_CAIP2', 'canton:devnet');
const PARTY_HINT = env('PARTY_HINT', 'ext-party-iv');
const KEY_NAME = env('KEY_NAME', PARTY_HINT.replace(/-/g, '_'));

function configureVaultCantonApi(): void {
  const base = requireEnv('IV_API_BASE_URL').replace(/\/$/, '');
  OpenAPI.BASE = `${base}/api/cwp/canton`;
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');
}

function ledgerAuth(): TokenProviderConfig {
  const issuer = requireEnv('CANTON_AUTH_ISSUER').replace(/\/$/, '');

  return {
    method: 'client_credentials',
    configUrl: `${issuer}/.well-known/openid-configuration`,
    credentials: {
      clientId: requireEnv('CANTON_AUTH_CLIENT_ID'),
      clientSecret: requireEnv('CANTON_AUTH_CLIENT_SECRET'),
      audience: env('CANTON_AUTH_AUDIENCE', 'https://canton.network.global'),
      scope: env('CANTON_AUTH_SCOPE', 'daml_ledger_api'),
    },
  };
}

async function createOrGetKey(name: string): Promise<Key> {
  const ctx = { masterKey: MASTER_KEY, caip2: CAIP2 };
  const existing = await KeysService.getKeys(ctx);
  const found = existing.find((k) => k.id === name || k.name === name);
  if (found) {
    console.log(`Using existing key: ${found.id}`);
    return found;
  }

  console.log(`Creating key: ${name}`);
  return KeysService.createKey({
    ...ctx,
    name,
    userIdentifier: requireEnv('IV_INITIATOR_ID'),
  });
}

async function signWithVault(params: {
  tx: string;
  txHash: string;
  publicKey: string;
  keyId: string;
}): Promise<string> {
  const ctx = { masterKey: MASTER_KEY, caip2: CAIP2 };
  let tx = await SigningService.signTransaction({
    ...ctx,
    keyIdentifier: { publicKey: params.publicKey, id: params.keyId },
    tx: params.tx,
    txHash: params.txHash,
    userIdentifier: requireEnv('IV_INITIATOR_ID'),
  });
  console.log(`  signTransaction txId=${tx.txId} status=${tx.status}`);

  for (let i = 0; i < 60 && tx.status === SigningStatus.PENDING; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    tx = await SigningService.getTransaction({ ...ctx, txId: tx.txId });
    console.log(`  poll ${i + 1}: status=${tx.status}`);
  }

  if (tx.status !== SigningStatus.SIGNED || !tx.signature) {
    throw new Error(
      `Signing finished with status=${tx.status} metadata=${JSON.stringify(tx.metadata)}`,
    );
  }
  return tx.signature;
}

async function main(): Promise<void> {
  configureVaultCantonApi();
  const auth = ledgerAuth();

  const sdk = await SDK.create({
    auth,
    ledgerClientUrl: requireEnv('LEDGER_CLIENT_URL'),
  });

  console.log('Step 1: createKey / getKeys');
  const key = await createOrGetKey(KEY_NAME);
  const fingerprint = await sdk.keys.fingerprint(key.publicKey);
  console.log(`  keyId=${key.id}`);
  console.log(`  publicKey=${key.publicKey}`);
  console.log(`  fingerprint=${fingerprint}`);

  console.log('\nStep 2: generate-topology');
  const prepared = sdk.party.external.create(key.publicKey, {
    partyHint: PARTY_HINT,
    confirmingThreshold: 1,
  });
  const topology = await prepared.topology();
  console.log(`  partyId=${topology.partyId}`);
  console.log(`  multiHash=${topology.multiHash}`);
  console.log(`  topologyTransactions=${topology.topologyTransactions.length}`);

  console.log('\nStep 3: signTransaction');
  const signature = await signWithVault({
    tx: Buffer.from(JSON.stringify(topology.topologyTransactions), 'utf-8').toString('base64'),
    txHash: topology.multiHash,
    publicKey: key.publicKey,
    keyId: key.id,
  });
  console.log(`  signature=${signature.slice(0, 40)}...`);

  console.log('\nStep 4: allocate');
  const party = await prepared.execute(signature, { grantUserRights: true });
  console.log(`  partyId=${party.partyId}`);
  console.log(`  publicKeyFingerprint=${party.publicKeyFingerprint}`);
  console.log('\nDone.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
