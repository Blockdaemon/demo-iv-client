/**
 * Create a Canton external party with Institutional Vault signing.
 *
 * Flow:
 *   1. createKey / getKeys on Vault (`/api/cwp/canton`)
 *   2. generate-topology on the participant JSON Ledger API
 *   3. signTransaction on Vault (topology multiHash)
 *   4. allocate on the participant
 *
 * Required env: IV_API_BASE_URL, IV_API_KEY, IV_USER_IDENTIFIER,
 * LEDGER_CLIENT_URL, CANTON_AUTH_CLIENT_SECRET (see .env-example).
 */

import { SDK, type TokenProviderConfig } from '@canton-network/wallet-sdk';
import {
  OpenAPI,
  KeysService,
  SigningService,
  SigningStatus,
  type Key,
} from './iv-sdk-canton-signing';

declare const process: any;
declare const require: any;
declare const module: any;

const MASTER_KEY = process.env.MASTER_KEY || 'Default';
const CAIP2 = process.env.CANTON_CAIP2 || 'canton:devnet';
const PARTY_HINT = process.env.PARTY_HINT || 'ext-party-iv';
const KEY_NAME = process.env.KEY_NAME || PARTY_HINT.replace(/-/g, '_');

function envRequired(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required - set it in .env`);
  return v;
}

function configureVaultCantonApi(): void {
  const base = envRequired('IV_API_BASE_URL').replace(/\/$/, '');
  OpenAPI.BASE = `${base}/api/cwp/canton`;
  OpenAPI.TOKEN = envRequired('IV_API_KEY');
}

function ledgerAuth(): TokenProviderConfig {
  const issuer = (
    process.env.CANTON_AUTH_ISSUER ||
    'https://keycloak.dev.canton.blockdaemon.com/realms/canton-devnet'
  ).replace(/\/$/, '');

  return {
    method: 'client_credentials',
    configUrl: `${issuer}/.well-known/openid-configuration`,
    credentials: {
      clientId: process.env.CANTON_AUTH_CLIENT_ID || 'bd-6-backend',
      clientSecret: envRequired('CANTON_AUTH_CLIENT_SECRET'),
      audience: process.env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global',
      scope: process.env.CANTON_AUTH_SCOPE || 'daml_ledger_api',
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
    userIdentifier: envRequired('IV_USER_IDENTIFIER'),
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
    userIdentifier: envRequired('IV_USER_IDENTIFIER'),
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
    ledgerClientUrl: envRequired('LEDGER_CLIENT_URL'),
  });

  // 1. Create (or reuse) an Ed25519 signing key in Vault
  console.log('Step 1: createKey / getKeys');
  const key = await createOrGetKey(KEY_NAME);
  const fingerprint = await sdk.keys.fingerprint(key.publicKey);
  console.log(`  keyId=${key.id}`);
  console.log(`  publicKey=${key.publicKey}`);
  console.log(`  fingerprint=${fingerprint}`);

  // 2. Generate topology on the participant
  console.log('\nStep 2: generate-topology');
  const prepared = sdk.party.external.create(key.publicKey, {
    partyHint: PARTY_HINT,
    confirmingThreshold: 1,
  });
  const topology = await prepared.topology();
  console.log(`  partyId=${topology.partyId}`);
  console.log(`  multiHash=${topology.multiHash}`);
  console.log(`  topologyTransactions=${topology.topologyTransactions.length}`);

  // 3. Sign the topology multiHash with Vault
  console.log('\nStep 3: signTransaction');
  const signature = await signWithVault({
    tx: Buffer.from(JSON.stringify(topology.topologyTransactions), 'utf-8').toString('base64'),
    txHash: topology.multiHash,
    publicKey: key.publicKey,
    keyId: key.id,
  });
  console.log(`  signature=${signature.slice(0, 40)}...`);

  // 4. Allocate the external party on the participant
  console.log('\nStep 4: allocate');
  const party = await prepared.execute(signature, { grantUserRights: true });
  console.log(`  partyId=${party.partyId}`);
  console.log(`  publicKeyFingerprint=${party.publicKeyFingerprint}`);
  console.log('\nDone.');
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
