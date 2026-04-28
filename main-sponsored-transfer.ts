import {
  TransactionsService,
  OperationsService,
  OpenAPI,
  TransferPost,
} from './iv-sdk-typescript';


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SPONSOR_ADDRESS = '0x7d751bFF5E84d1a750F4416c26b41513Af144F61';  //gasSponsorVault1

const FROM_ADDRESS = '0x17F828dbbB662aaD51b1FA8Be44804Dae52C9585';  //gaslessVault1
const TO_ADDRESS   = '0x6081ebA37Eab2B67f38D2aE4e7D3C01a986b63B6';  //payments1vault
const ASSET_ID     = 30; // BD1404
const AMOUNT       = '33000000000000000000';  // 33 BD1404



declare const process: any;
declare const require: any;
declare const module: any;

OpenAPI.BASE =
  (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) ||
  'https://americas-sales-team-1.api.blockdaemon-wallet.com';
OpenAPI.TOKEN =
  (typeof process !== 'undefined' && process.env?.IV_API_KEY) as string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createSponsoredTransfer(
  sponsorAddress: string,
  fromAddress: string,
  toAddress: string,
  amount: string,
  assetID: number,
): Promise<string> {
  const body: TransferPost = {
    type: TransferPost.type.TRANSFER,
    assetID,
    fromAddressAmountArray: [{ address: fromAddress, amount }],
    toAddressAmountArray:   [{ address: toAddress }],
    sponsorAddress,
    reference: `sponsored-batch-${Date.now()}`,
  };

  const response = await TransactionsService.createTransfer(body) as any;
  const asyncOperationID = response?.asyncOperationID;
  if (!asyncOperationID) {
    throw new Error(`Missing asyncOperationID in response: ${JSON.stringify(response)}`);
  }
  return asyncOperationID;
}

async function waitForOperation(
  operationId: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<any> {
  console.log('Monitoring async operation status...');

  for (let i = 0; i < maxAttempts; i++) {
    const op = (await OperationsService.getMpaOperationById(operationId as any)) as any;
    const status = op.Status || op.status;
    console.log(`  [${i + 1}/${maxAttempts}] status=${status}`);

    if (status === 'fin') {
      return op;
    }
    if (status === 'err' || status === 'rej' || status === 'can') {
      throw new Error(`Operation ended with status "${status}": ${JSON.stringify(op.errorDetails || op)}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error('Timed out waiting for operation');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Starting sponsored transfer via /api/v2/transfers...');
  console.log(`  Sponsor : ${SPONSOR_ADDRESS}`);
  console.log(`  From    : ${FROM_ADDRESS}`);
  console.log(`  To      : ${TO_ADDRESS}`);
  console.log(`  Amount  : ${AMOUNT}`);
  console.log(`  Asset ID: ${ASSET_ID}`);
  console.log('');

  const asyncOpID = await createSponsoredTransfer(
    SPONSOR_ADDRESS, FROM_ADDRESS, TO_ADDRESS, AMOUNT, ASSET_ID,
  );
  console.log(`Submitted. asyncOperationID = ${asyncOpID}\n`);

  const result = await waitForOperation(asyncOpID);
  console.log('\nOperation complete:');
  console.log(JSON.stringify(result, null, 2));
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('Error:', err);
    if (typeof process !== 'undefined') process.exit(1);
  });
}

export { main };
