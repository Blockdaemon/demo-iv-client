import { OpenAPI } from './iv-sdk-typescript';
import { SDK, type TokenProviderConfig } from '@canton-network/wallet-sdk';

declare const process: any;
declare const module: any;

function env(key: string, fallback?: string): string {
  return (typeof process !== 'undefined' && process.env?.[key]) || fallback || '';
}

const SOURCE_ADDRESS = 'bd::1220cb5a435acd08ab6712521dee6c43c94e41004c4faaf75c1854ad0cc2e82650b2';
const DESTINATION_ADDRESS = 'bd::12200a47bff4dbfc146024b7ee1af3f164ce54ea18a5d05d386582878b072f823d2d';
const CANTON_CAIP2 = 'canton:devnet';
const TRANSFER_AMOUNT = '1';
const DEFAULT_MASTER_KEY_NAME = 'Default';
const INITIATOR_ID = 'gmay@blockdaemon.com';

type CantonSDK = Awaited<ReturnType<typeof createCantonSDK>>;

// ---------------------------------------------------------------------------
// Canton wallet SDK v1: create SDK instance
// ---------------------------------------------------------------------------

async function createCantonSDK() {
  const issuer = env('CANTON_AUTH_ISSUER', 'https://keycloak.dev.canton.blockdaemon.com/realms/canton-devnet');
  const clientId = env('CANTON_AUTH_CLIENT_ID', 'ledger-api-user');
  const clientSecret = env('CANTON_AUTH_CLIENT_SECRET', 'unsafe');
  const audience = env('CANTON_AUTH_AUDIENCE', 'https://canton.network.global');
  const validatorUrl = env('VALIDATOR_URL', 'http://localhost:2000/api/validator');
  const ledgerClientUrl = env('LEDGER_CLIENT_URL', 'http://localhost:2975');
  const scanProxyUrl = env('SCAN_PROXY_URL', 'http://localhost:2000/api/validator');

  const auth: TokenProviderConfig = issuer === 'unsafe-auth'
    ? { method: 'self_signed', issuer: 'unsafe-auth', credentials: { clientId, clientSecret, audience, scope: '' } }
    : { method: 'client_credentials', configUrl: issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', credentials: { clientId, clientSecret, audience, scope: 'daml_ledger_api' } };

  const registryUrl = new URL(`${scanProxyUrl}/v0/scan-proxy`);

  return SDK.create({
    auth,
    ledgerClientUrl,
    token: { validatorUrl, auth, registries: [registryUrl] },
  });
}

// ---------------------------------------------------------------------------
// Step 1: Prepare the Canton transfer transaction via the wallet SDK
// ---------------------------------------------------------------------------

async function prepareCantonTransfer(
  sdk: CantonSDK,
  params: { senderAddress: string; recipientAddress: string; amount: string },
) {
  const registryUrl = new URL(`${env('SCAN_PROXY_URL', 'http://localhost:2000/api/validator')}/v0/scan-proxy`);

  const [transferCommand, disclosedContracts] = await sdk.token.transfer.create({
    sender: params.senderAddress,
    recipient: params.recipientAddress,
    amount: params.amount,
    instrumentId: 'Amulet',
    registryUrl,
  });

  const prepared = sdk.ledger.prepare({
    partyId: params.senderAddress,
    commands: transferCommand,
    disclosedContracts,
  });

  const json = await prepared.toJSON();
  if (!json.response.preparedTransaction || !json.response.preparedTransactionHash) {
    throw new Error('Ledger prepare did not return preparedTransaction or hash');
  }

  const prepareResponse = await prepared.preparedPromise;

  return {
    preparedTransaction: json.response.preparedTransaction,
    preparedTransactionHash: json.response.preparedTransactionHash,
    prepareResponse,
  };
}

// ---------------------------------------------------------------------------
// Step 2: Fetch the Ed25519 public key from IV Canton Signing API
// ---------------------------------------------------------------------------

async function getCantonPublicKeyForParty(sdk: CantonSDK, partyId: string): Promise<string> {
  const baseUrl = OpenAPI.BASE;
  const resp = await fetch(`${baseUrl}/api/cwp/canton/getKeys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(OpenAPI.TOKEN ? { Authorization: `Bearer ${OpenAPI.TOKEN}` } : {}),
    },
    body: JSON.stringify({ masterKey: DEFAULT_MASTER_KEY_NAME, caip2: CANTON_CAIP2 }),
  });

  if (!resp.ok) {
    throw new Error(`getKeys failed: ${resp.status} ${await resp.text()}`);
  }

  const keys: Array<{ id: string; name: string; publicKey: string }> = await resp.json();
  if (!keys.length) {
    throw new Error('getKeys returned no keys');
  }

  const namespaceIdx = partyId.indexOf('::');
  if (namespaceIdx < 0) {
    throw new Error(`invalid partyId (missing '::'): ${partyId}`);
  }
  const namespace = partyId.slice(namespaceIdx + 2);

  for (const key of keys) {
    const fingerprint = await sdk.keys.fingerprint(key.publicKey);
    if (fingerprint === namespace) {
      console.log(`  Matched key account=${key.name} fingerprint=${fingerprint}`);
      return key.publicKey;
    }
  }

  throw new Error(
    `no IV key matches partyId namespace ${namespace}; got ${keys.length} key(s): ${keys.map(k => k.name).join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// Step 3: Submit to MPA Canton signing API
// ---------------------------------------------------------------------------

async function signCantonTransaction(params: {
  tx: string;
  txHash: string;
  publicKey: string;
}): Promise<string> {
  const url = `${OpenAPI.BASE}/api/cwp/canton/signTransaction`;
  const body = {
    masterKey: DEFAULT_MASTER_KEY_NAME,
    caip2: CANTON_CAIP2,
    tx: params.tx,
    txHash: params.txHash,
    keyIdentifier: { publicKey: params.publicKey },
    userIdentifier: INITIATOR_ID,
  };

  console.log('  Request body:', JSON.stringify(body, null, 2));

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(OpenAPI.TOKEN ? { Authorization: `Bearer ${OpenAPI.TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`signTransaction failed: ${resp.status} ${await resp.text()}`);
  }

  const result = await resp.json();
  if (result.error) {
    throw new Error(`signTransaction error: ${result.error} — ${result.error_description}`);
  }

  return result.txId as string;
}

// ---------------------------------------------------------------------------
// Step 4: Poll MPA getTransaction until signing completes
// ---------------------------------------------------------------------------

async function waitForSignature(txId: string): Promise<{ signature?: string } | null> {
  console.log('  Polling transaction status...');
  const url = `${OpenAPI.BASE}/api/cwp/canton/getTransaction`;

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(OpenAPI.TOKEN ? { Authorization: `Bearer ${OpenAPI.TOKEN}` } : {}),
        },
        body: JSON.stringify({ txId }),
      });

      if (!resp.ok) {
        console.error(`  Poll HTTP error (attempt ${i + 1}): ${resp.status}`);
      } else {
        const tx = await resp.json();
        console.log(`  [${i + 1}/${maxAttempts}] status=${tx.status}`);

        if (tx.error) {
          console.error('  Transaction error:', tx.error_description);
          return null;
        }
        if (tx.status === 'signed') {
          return { signature: tx.signature };
        }
        if (tx.status === 'rejected' || tx.status === 'failed') {
          console.error('  Transaction signing failed with status:', tx.status);
          return null;
        }
      }
    } catch (err: any) {
      console.error(`  Poll error (attempt ${i + 1}):`, err.message || err);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.error('  Timeout waiting for signature');
  return null;
}

// ---------------------------------------------------------------------------
// Step 5: Execute the signed transaction on the Canton ledger
// ---------------------------------------------------------------------------

async function executeCantonTransaction(
  sdk: CantonSDK,
  prepareResponse: any,
  signature: string,
  partyId: string,
): Promise<void> {
  const signed = sdk.ledger.fromSignature(prepareResponse, signature);
  const completion = await sdk.ledger.execute(signed, { partyId });
  console.log('  Ledger completion:', JSON.stringify(completion, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  OpenAPI.BASE = env('IV_API_BASE_URL', 'https://americas-sales-team-1.api.blockdaemon-wallet.com');
  OpenAPI.TOKEN = env('IV_API_KEY');

  if (!SOURCE_ADDRESS || !DESTINATION_ADDRESS) {
    console.error('Set SOURCE_ADDRESS and DESTINATION_ADDRESS environment variables');
    if (typeof process !== 'undefined') process.exit(1);
    return;
  }

  console.log('Canton CC raw-transaction transfer via IV (Canton Signing API)');
  console.log(`  Source party:      ${SOURCE_ADDRESS}`);
  console.log(`  Destination party: ${DESTINATION_ADDRESS}`);
  console.log(`  Amount:            ${TRANSFER_AMOUNT} CC\n`);

  // 0. Create the Canton wallet SDK v1 instance
  console.log('Connecting Canton wallet SDK...');
  const sdk = await createCantonSDK();
  console.log('');

  // 1. Prepare the Canton transfer via the wallet SDK
  console.log('Step 1: Preparing Canton transfer with wallet SDK...');
  const { preparedTransaction, preparedTransactionHash, prepareResponse } =
    await prepareCantonTransfer(sdk, {
      senderAddress: SOURCE_ADDRESS,
      recipientAddress: DESTINATION_ADDRESS,
      amount: TRANSFER_AMOUNT,
    });
  console.log(`  preparedTransaction length: ${preparedTransaction.length} chars (base64)`);
  console.log(`  preparedTransactionHash:    ${preparedTransactionHash}\n`);

  // 2. Fetch the Ed25519 public key from IV (needed for signTransaction keyIdentifier)
  console.log('Step 2: Fetching Canton public key from IV...');
  const publicKey = await getCantonPublicKeyForParty(sdk, SOURCE_ADDRESS);
  console.log(`  PublicKey (base64): ${publicKey}\n`);

  // 3. Submit to MPA Canton signTransaction API
  console.log('Step 3: Submitting signTransaction to MPA Canton API...');
  const txId = await signCantonTransaction({
    tx: preparedTransaction,
    txHash: preparedTransactionHash,
    publicKey,
  });
  console.log(`  txId: ${txId}\n`);

  // 4. Poll MPA for signing completion
  console.log('Step 4: Waiting for signing...');
  const result = await waitForSignature(txId);
  if (!result?.signature) {
    throw new Error('Transaction did not return a signature');
  }
  console.log(`  Signature (base64): ${result.signature}\n`);

  // 5. Execute the signed transaction on the Canton ledger
  console.log('Step 5: Executing signed transaction on Canton ledger...');
  await executeCantonTransaction(sdk, prepareResponse, result.signature, SOURCE_ADDRESS);
  console.log('\nDone. Transfer submitted to Canton ledger.');
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    if (typeof process !== 'undefined') process.exit(1);
  });
}

export { main };
