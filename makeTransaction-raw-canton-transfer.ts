import {
  TransactionsService,
  OpenAPI,
  cwpStatus,
  type cwpMakeTransactionStartRequest,
  type cwpResult,
} from './iv-sdk-typescript';
import { SDK, type TokenProviderConfig } from '@canton-network/wallet-sdk';
import { env, requireEnv } from './lib/env';
import { waitForOperation } from './lib/waitForOperation';

type CantonSDK = Awaited<ReturnType<typeof createCantonSDK>>;

async function createCantonSDK() {
  const issuer = requireEnv('CANTON_AUTH_ISSUER');
  const clientId = requireEnv('CANTON_AUTH_CLIENT_ID');
  const clientSecret = requireEnv('CANTON_AUTH_CLIENT_SECRET');
  const audience = env('CANTON_AUTH_AUDIENCE', 'https://canton.network.global');
  const validatorUrl = process.env.VALIDATOR_URL;
  const ledgerClientUrl = requireEnv('LEDGER_CLIENT_URL');
  const scanProxyUrl = process.env.SCAN_PROXY_URL;

  const auth: TokenProviderConfig = {
    method: 'client_credentials',
    configUrl: issuer.replace(/\/$/, '') + '/.well-known/openid-configuration',
    credentials: {
      clientId,
      clientSecret,
      audience,
      scope: env('CANTON_AUTH_SCOPE', 'daml_ledger_api'),
    },
  };

  const registryUrl = new URL(`${scanProxyUrl || validatorUrl}/v0/scan-proxy`);

  return SDK.create({
    auth,
    ledgerClientUrl,
    token: { validatorUrl: validatorUrl || ledgerClientUrl, auth, registries: [registryUrl] },
  });
}

async function prepareCantonTransfer(
  sdk: CantonSDK,
  params: { senderAddress: string; recipientAddress: string; amount: string },
) {
  const scanProxyUrl = process.env.SCAN_PROXY_URL || process.env.VALIDATOR_URL;
  const registryUrl = new URL(`${scanProxyUrl}/v0/scan-proxy`);

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
  sourceAddress: string;
  rawTransaction: string;
  txHash: string;
  initiatorId?: string;
}): cwpMakeTransactionStartRequest {
  return {
    CAIP19: opts.caip19,
    Source: { Address: opts.sourceAddress },
    RawTransaction: opts.rawTransaction,
    TxHash: opts.txHash,
    ...(opts.initiatorId ? { InitiatorID: opts.initiatorId } : {}),
  };
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
  OpenAPI.BASE = requireEnv('IV_API_BASE_URL');
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');

  const caip19 = env('IV_CAIP19', 'canton:devnet/slip44:6767');
  const initiatorId = process.env.IV_INITIATOR_ID || undefined;
  const sourceAddress = requireEnv('CANTON_SOURCE_ADDRESS');
  const destinationAddress = requireEnv('CANTON_DESTINATION_ADDRESS');
  const transferAmount = env('CANTON_TRANSFER_AMOUNT', '1');

  console.log('Canton CC raw-transaction transfer via Vault');
  console.log(`  Source party:      ${sourceAddress}`);
  console.log(`  Destination party: ${destinationAddress}`);
  console.log(`  Amount:            ${transferAmount} CC`);
  console.log(`  CAIP-19:           ${caip19}\n`);

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

  console.log('Step 2: Submitting makeTransaction to Vault...');
  const request = buildCantonRawRequest({
    caip19,
    sourceAddress,
    rawTransaction: preparedTransaction,
    txHash: preparedTransactionHash,
    initiatorId,
  });
  console.log('  Request body:', JSON.stringify(request, null, 2));

  const { OperationID } = await TransactionsService.cwpstartMakeTransaction(request);
  console.log(`  OperationID: ${OperationID}\n`);

  console.log('Step 3: Waiting for MPC signing...');
  const op = await waitForOperation(OperationID);
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
