import { randomUUID } from 'crypto';
import {
  CwpOperationsService,
  OpenAPI,
  type cwpTransactionIntent,
  type cwpOperationStatus,
  cwpStatus,
} from './iv-sdk-typescript';
import type { WalletSDKImpl as WalletSDKType } from '@canton-network/wallet-sdk';
import type { PrepareSubmissionResponse } from '@canton-network/core-ledger-client';

declare const process: any;
declare const module: any;

// Canton party IDs (set via env or hardcode for your deployment)
const SOURCE_ADDRESS = 'bd::1220517ebe84583a41cc0edad72dc824028b05683659d48e8d6ed273d73b252a6462';
const DESTINATION_ADDRESS = 'bd::12205659285192975fa3b056496bb030966f214ab8db7b814dc1d348523c57656494';
// Canton asset identifiers for CC (Amulet)
const CANTON_CAIP19 = 'canton:devnet/slip44:6767';
const CANTON_CAIP2 = 'canton:devnet';
const TRANSFER_AMOUNT = '1';
const DEFAULT_MASTER_KEY_NAME = 'Default';

// Canton wallet SDK validator / ledger configuration
const VALIDATOR_URL = (typeof process !== 'undefined' && process.env?.VALIDATOR_URL) || 'http://localhost:2000/api/validator';
const LEDGER_CLIENT_URL = (typeof process !== 'undefined' && process.env?.LEDGER_CLIENT_URL) || 'http://localhost:2975';
const SCAN_PROXY_URL = (typeof process !== 'undefined' && process.env?.SCAN_PROXY_URL) || 'http://localhost:2000/api/validator';

// Canton wallet SDK auth (self_signed for local dev)
const CANTON_AUTH_ISSUER = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_ISSUER) || 'https://keycloak.dev.canton.blockdaemon.com/realms/canton-devnet';
const CANTON_AUTH_CLIENT_ID = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_CLIENT_ID) || 'ledger-api-user';
const CANTON_AUTH_CLIENT_SECRET = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_CLIENT_SECRET) || 'unsafe';
const CANTON_AUTH_AUDIENCE = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_AUDIENCE) || 'https://canton.network.global';

// IV API configuration
OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://americas-sales-team-1.api.blockdaemon-wallet.com';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);

// ---------------------------------------------------------------------------
// Canton wallet SDK: create and connect a reusable SDK instance
// ---------------------------------------------------------------------------

function jwtSub(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (!payload.sub) throw new Error('JWT missing sub claim');
  return payload.sub as string;
}

async function createCantonSDK(partyId: string): Promise<WalletSDKType> {
  const {
    WalletSDKImpl,
    ClientCredentialOAuthController,
    UnsafeAuthController,
    LedgerController,
    TokenStandardController,
  } = await import('@canton-network/wallet-sdk');

  const sdk = new WalletSDKImpl();

  const isUnsafeAuth = CANTON_AUTH_ISSUER === 'unsafe-auth';
  if (isUnsafeAuth) {
    const auth = new UnsafeAuthController();
    auth.userId = CANTON_AUTH_CLIENT_ID;
    auth.audience = CANTON_AUTH_AUDIENCE;
    auth.unsafeSecret = CANTON_AUTH_CLIENT_SECRET;
    sdk.configure({ authFactory: () => auth });
  } else {
    const configUrl = CANTON_AUTH_ISSUER.replace(/\/$/, '') + '/.well-known/openid-configuration';
    const inner = new ClientCredentialOAuthController(
      configUrl,
      undefined,
      CANTON_AUTH_CLIENT_ID,
      CANTON_AUTH_CLIENT_SECRET,
      CANTON_AUTH_CLIENT_ID,
      CANTON_AUTH_CLIENT_SECRET,
    );
    inner.audience = CANTON_AUTH_AUDIENCE;
    inner.scope = 'daml_ledger_api';

    const auth = {
      getUserToken: async () => {
        const ctx = await inner.getUserToken();
        return { userId: jwtSub(ctx.accessToken), accessToken: ctx.accessToken };
      },
      getAdminToken: async () => {
        const ctx = await inner.getAdminToken();
        return { userId: jwtSub(ctx.accessToken), accessToken: ctx.accessToken };
      },
    };
    sdk.configure({ authFactory: () => auth as any });
  }

  sdk.configure({
    ledgerFactory: (userId: string, authTokenProvider: any, isAdmin: boolean) =>
      new LedgerController(userId, new URL(LEDGER_CLIENT_URL), undefined, isAdmin, authTokenProvider),
    tokenStandardFactory: (userId: string, authTokenProvider: any, isAdmin: boolean) =>
      new TokenStandardController(userId, new URL(LEDGER_CLIENT_URL), new URL(VALIDATOR_URL), undefined, authTokenProvider, isAdmin),
  });

  await sdk.connect();
  await sdk.setPartyId(partyId);
  sdk.tokenStandard!.setTransferFactoryRegistryUrl(new URL(`${SCAN_PROXY_URL}/v0/scan-proxy`));

  return sdk;
}

// ---------------------------------------------------------------------------
// Step 1: Prepare the Canton transfer transaction via the wallet SDK
// ---------------------------------------------------------------------------

async function prepareCantonTransfer(
  sdk: WalletSDKType,
  params: { senderAddress: string; recipientAddress: string; amount: string },
): Promise<{ prepared: PrepareSubmissionResponse; submissionId: string }> {
  const submissionId = randomUUID();

  const [transferCommand, disclosedContracts] = await sdk.tokenStandard!.createTransfer(
    params.senderAddress,
    params.recipientAddress,
    params.amount,
    { instrumentId: 'Amulet' },
  );

  const prepared = await sdk.userLedger!.prepareSubmission(
    transferCommand,
    submissionId,
    disclosedContracts,
  );

  if (!prepared.preparedTransaction || !prepared.preparedTransactionHash) {
    throw new Error('Ledger prepare did not return preparedTransaction or hash');
  }

  return { prepared, submissionId };
}

// ---------------------------------------------------------------------------
// Step 2: Submit to IV via CWP /operations/start/makeTransaction
// ---------------------------------------------------------------------------

async function submitMakeTransaction(params: {
  sourceAddress: string;
  rawTransaction: string;
  txHash: string;
}): Promise<string> {
  const intent: cwpTransactionIntent = {
    InitiatorID: 'gmay@blockdaemon.com',
    CAIP19: CANTON_CAIP19,
    Source: {
      Address: params.sourceAddress,
    },
    RawTransaction: params.rawTransaction,
    TxHash: params.txHash,
  };

  console.log('  Request body:', JSON.stringify(intent, null, 2));

  const resp = await CwpOperationsService.cwpstartMakeTransaction(intent);
  return resp.OperationID;
}

// ---------------------------------------------------------------------------
// Step 3: Poll CWP operation status until MPC signing completes
// ---------------------------------------------------------------------------

async function waitForOperation(operationId: string): Promise<{ signature?: string } | null> {
  console.log('  Polling operation status...');

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const op: cwpOperationStatus = await CwpOperationsService.cwpgetOperationStatus(operationId);
      console.log(`  [${i + 1}/${maxAttempts}] status=${op.Status}`);

      if (op.Status === cwpStatus.SUCCEEDED) {
        return { signature: op.Result?.Transaction?.SignedTransaction };
      }
      if (op.Status === cwpStatus.FAILED) {
        console.error('  Operation failed:', op.ErrorDetails);
        return null;
      }
    } catch (err: any) {
      console.error(`  Poll error (attempt ${i + 1}):`, err.message || err);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.error('  Timeout waiting for operation');
  return null;
}

// ---------------------------------------------------------------------------
// Step 4: Fetch the Ed25519 public key from IV Canton Signing API
// ---------------------------------------------------------------------------

async function getCantonPublicKeyForParty(partyId: string): Promise<string> {
  const url = `${OpenAPI.BASE}/api/cwp/canton/getKeys`;
  const resp = await fetch(url, {
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

  // A Canton partyId has the form `<hint>::<namespace>` where `namespace` is the
  // fingerprint of the party's public key. Match each IV key's fingerprint to
  // the partyId's namespace to pick the right one when IV returns multiple keys.
  const namespaceIdx = partyId.indexOf('::');
  if (namespaceIdx < 0) {
    throw new Error(`invalid partyId (missing '::'): ${partyId}`);
  }
  const namespace = partyId.slice(namespaceIdx + 2);

  const { TopologyController } = await import('@canton-network/wallet-sdk');
  for (const key of keys) {
    const fingerprint = TopologyController.createFingerprintFromPublicKey(key.publicKey);
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
// Step 5: Execute the signed transaction on the Canton ledger
// ---------------------------------------------------------------------------

async function executeCantonTransaction(
  sdk: WalletSDKType,
  prepared: PrepareSubmissionResponse,
  signature: string,
  publicKey: string,
  submissionId: string,
): Promise<void> {
  const completion = await sdk.userLedger!.executeSubmissionAndWaitFor(
    prepared,
    signature,
    publicKey,
    submissionId,
    30_000,
  );
  console.log('  Ledger completion:', JSON.stringify(completion, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!SOURCE_ADDRESS || !DESTINATION_ADDRESS) {
    console.error('Set SOURCE_ADDRESS and DESTINATION_ADDRESS environment variables');
    if (typeof process !== 'undefined') process.exit(1);
    return;
  }

  console.log('Canton CC raw-transaction transfer via IV');
  console.log(`  Source party:      ${SOURCE_ADDRESS}`);
  console.log(`  Destination party: ${DESTINATION_ADDRESS}`);
  console.log(`  Amount:            ${TRANSFER_AMOUNT} CC\n`);

  // 0. Connect the Canton wallet SDK (reused for prepare + execute)
  console.log('Connecting Canton wallet SDK...');
  const sdk = await createCantonSDK(SOURCE_ADDRESS);
  console.log('');

  // 1. Prepare the Canton transfer via the wallet SDK
  console.log('Step 1: Preparing Canton transfer with wallet SDK...');
  const { prepared, submissionId } = await prepareCantonTransfer(sdk, {
    senderAddress: SOURCE_ADDRESS,
    recipientAddress: DESTINATION_ADDRESS,
    amount: TRANSFER_AMOUNT,
  });
  console.log(`  preparedTransaction length: ${prepared.preparedTransaction!.length} chars (base64)`);
  console.log(`  preparedTransactionHash:    ${prepared.preparedTransactionHash}`);
  console.log(`  submissionId:               ${submissionId}\n`);

  // 2. Submit to IV CWP makeTransaction with the base64 RawTransaction
  console.log('Step 2: Submitting makeTransaction to IV...');
  const operationId = await submitMakeTransaction({
    sourceAddress: SOURCE_ADDRESS,
    rawTransaction: prepared.preparedTransaction!,
    txHash: prepared.preparedTransactionHash,
  });
  console.log(`  OperationID: ${operationId}\n`);

  // 3. Poll IV for MPC signing completion
  console.log('Step 3: Waiting for MPC signing...');
  const result = await waitForOperation(operationId);
  if (!result?.signature) {
    throw new Error('Operation did not return a signature');
  }
  console.log(`  Signature (base64): ${result.signature}\n`);

  // 4. Fetch the Ed25519 public key from IV (match by partyId namespace)
  console.log('Step 4: Fetching Canton public key from IV...');
  const publicKey = await getCantonPublicKeyForParty(SOURCE_ADDRESS);
  console.log(`  PublicKey (base64): ${publicKey}\n`);

  // 5. Execute the signed transaction on the Canton ledger
  console.log('Step 5: Executing signed transaction on Canton ledger...');
  await executeCantonTransaction(sdk, prepared, result.signature, publicKey, submissionId);
  console.log('\nDone. Transfer submitted to Canton ledger.');
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    if (typeof process !== 'undefined') process.exit(1);
  });
}

export { main };
