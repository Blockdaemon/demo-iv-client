import {
  TransactionsService,
  OperationsService,
  OpenAPI,
  cwpStatus,
  type cwpMakeTransactionStartRequest,
  type cwpOperationStatus,
  type cwpResult,
} from './iv-sdk-typescript';
import { SDK, type TokenProviderConfig } from '@canton-network/wallet-sdk';

const SOURCE_ADDRESS =
  'bd::1220cb5a435acd08ab6712521dee6c43c94e41004c4faaf75c1854ad0cc2e82650b2';
const DESTINATION_ADDRESS =
  'bd::12200a47bff4dbfc146024b7ee1af3f164ce54ea18a5d05d386582878b072f823d2d';
const CANTON_CAIP19 = 'canton:devnet/slip44:6767';
const TRANSFER_AMOUNT = '1';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

OpenAPI.BASE = env('IV_API_BASE_URL');
OpenAPI.TOKEN = env('IV_API_KEY');

type CantonSDK = Awaited<ReturnType<typeof createCantonSDK>>;

async function createCantonSDK() {
  const issuer = env(
    'CANTON_AUTH_ISSUER',
    'https://keycloak.dev.canton.blockdaemon.com/realms/canton-devnet',
  );
  const clientId = env('CANTON_AUTH_CLIENT_ID', 'ledger-api-user');
  const clientSecret = env('CANTON_AUTH_CLIENT_SECRET', 'unsafe');
  const audience = env('CANTON_AUTH_AUDIENCE', 'https://canton.network.global');
  const validatorUrl = env('VALIDATOR_URL', 'http://localhost:2000/api/validator');
  const ledgerClientUrl = env('LEDGER_CLIENT_URL', 'http://localhost:2975');
  const scanProxyUrl = env('SCAN_PROXY_URL', 'http://localhost:2000/api/validator');

  const auth: TokenProviderConfig =
    issuer === 'unsafe-auth'
      ? {
          method: 'self_signed',
          issuer: 'unsafe-auth',
          credentials: { clientId, clientSecret, audience, scope: '' },
        }
      : {
          method: 'client_credentials',
          configUrl: issuer.replace(/\/$/, '') + '/.well-known/openid-configuration',
          credentials: { clientId, clientSecret, audience, scope: 'daml_ledger_api' },
        };

  const registryUrl = new URL(`${scanProxyUrl}/v0/scan-proxy`);

  return SDK.create({
    auth,
    ledgerClientUrl,
    token: { validatorUrl, auth, registries: [registryUrl] },
  });
}

async function prepareCantonTransfer(
  sdk: CantonSDK,
  params: { senderAddress: string; recipientAddress: string; amount: string },
) {
  const registryUrl = new URL(
    `${env('SCAN_PROXY_URL', 'http://localhost:2000/api/validator')}/v0/scan-proxy`,
  );

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

function buildCantonRawRequest(opts: {
  caip19: string;
  testNetwork: boolean;
  sourceAddress: string;
  rawTransaction: string;
  txHash: string;
  initiatorId?: string;
}): cwpMakeTransactionStartRequest {
  return {
    CAIP19: opts.caip19,
    TestNetwork: opts.testNetwork,
    Source: { Address: opts.sourceAddress },
    RawTransaction: opts.rawTransaction,
    TxHash: opts.txHash,
    ...(opts.initiatorId ? { InitiatorID: opts.initiatorId } : {}),
  };
}

async function waitForTerminalStatus(operationId: string): Promise<cwpOperationStatus> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const op = await OperationsService.cwpgetOperationStatus(operationId);
    console.log(`  [${attempt}/${MAX_POLL_ATTEMPTS}] status=${op.Status}`);

    if (op.Status === cwpStatus.SUCCEEDED || op.Status === cwpStatus.FAILED) {
      return op;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Timeout waiting for operation');
}

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

export async function main() {
  const caip19 = env('IV_CAIP19', CANTON_CAIP19);
  const testNetwork = env('IV_TEST_NETWORK', 'true') !== 'false';
  const initiatorId = env('IV_INITIATOR_ID') || undefined;
  const sourceAddress = env('CANTON_SOURCE_ADDRESS', SOURCE_ADDRESS);
  const destinationAddress = env('CANTON_DESTINATION_ADDRESS', DESTINATION_ADDRESS);
  const transferAmount = env('CANTON_TRANSFER_AMOUNT', TRANSFER_AMOUNT);

  if (!OpenAPI.TOKEN) {
    console.error('Set IV_API_KEY');
    process.exit(1);
  }

  console.log('Canton CC raw-transaction transfer via IV');
  console.log(`  Source party:      ${sourceAddress}`);
  console.log(`  Destination party: ${destinationAddress}`);
  console.log(`  Amount:            ${transferAmount} CC`);
  console.log(`  CAIP-19:           ${caip19}`);
  console.log(`  TestNetwork:       ${testNetwork}\n`);

  console.log('Connecting Canton wallet SDK...');
  const sdk = await createCantonSDK();
  console.log('');

  console.log('Step 1: Preparing Canton transfer with wallet SDK...');
  const { preparedTransaction, preparedTransactionHash, prepareResponse } =
    await prepareCantonTransfer(sdk, {
      senderAddress: sourceAddress,
      recipientAddress: destinationAddress,
      amount: transferAmount,
    });
  console.log(`  preparedTransaction length: ${preparedTransaction.length} chars (base64)`);
  console.log(`  preparedTransactionHash:    ${preparedTransactionHash}\n`);

  console.log('Step 2: Submitting makeTransaction to IV...');
  const request = buildCantonRawRequest({
    caip19,
    testNetwork,
    sourceAddress,
    rawTransaction: preparedTransaction,
    txHash: preparedTransactionHash,
    initiatorId,
  });
  console.log('  Request body:', JSON.stringify(request, null, 2));

  const { OperationID } = await TransactionsService.cwpstartMakeTransaction(request);
  console.log(`  OperationID: ${OperationID}\n`);

  console.log('Step 3: Waiting for MPC signing...');
  const op = await waitForTerminalStatus(OperationID);
  if (op.Status === cwpStatus.FAILED) {
    console.error('  Operation failed:', op.ErrorDetails);
    process.exit(1);
  }

  const result: cwpResult | undefined = op.Result;
  const signature = result?.Transaction?.SignedTransaction;
  if (!signature) {
    throw new Error('Operation succeeded but Result.Transaction.SignedTransaction is missing');
  }
  console.log(`  Signature (base64): ${signature}\n`);

  console.log('Step 4: Executing signed transaction on Canton ledger...');
  await executeCantonTransaction(sdk, prepareResponse, signature, sourceAddress);
  console.log('\nDone. Transfer submitted to Canton ledger.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
