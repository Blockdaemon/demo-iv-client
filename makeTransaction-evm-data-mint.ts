import {
  TransactionsService,
  OperationsService,
  OpenAPI,
  cwpStatus,
  type cwpMakeTransactionStartRequest,
  type cwpOperationStatus,
  type cwpResult,
  type cwpTransaction,
} from './iv-sdk-typescript';
import { encodeFunctionData, parseAbi } from 'viem';

const WITHDRAWAL_ADDRESS = '0x16429055827A6863d291D6bDd63cBB71A3E85d60' as const;
const RECEIVER_ADDRESS = '0x3950D663c85340C7af8d7d09bb3dad1cd98Dd18a' as const;
const TOKEN_CONTRACT_ADDRESS = '0x21741b361292bbf43c5069d2477c159494071aff' as const;
/** Mint amount in smallest units (token decimals), e.g. 40e18 for 18-decimal token. */
const MINT_AMOUNT_WEI = '40000000000000000000';

const DEFAULT_CAIP19 = 'eip155:560048/slip44:60';
const DEFAULT_EXPLORER_TX = 'https://hoodi.etherscan.io/tx/';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

OpenAPI.BASE = env('IV_API_BASE_URL');
OpenAPI.TOKEN = env('IV_API_KEY');

function buildMintCalldata(to: typeof RECEIVER_ADDRESS, amountWei: bigint): string {
  const abi = parseAbi(['function mint(address to, uint256 amount)']);
  return encodeFunctionData({
    abi,
    functionName: 'mint',
    args: [to, amountWei],
  });
}

function buildMintRequest(
  calldata: string,
  opts: { caip19: string; testNetwork: boolean; initiatorId?: string },
): cwpMakeTransactionStartRequest {
  return {
    CAIP19: opts.caip19,
    TestNetwork: opts.testNetwork,
    Source: { Address: WITHDRAWAL_ADDRESS },
    Destination: [{ Address: TOKEN_CONTRACT_ADDRESS, Amount: '0' }],
    EVM: { Data: calldata },
    ...(opts.initiatorId ? { InitiatorID: opts.initiatorId } : {}),
  };
}

async function waitForTerminalStatus(operationId: string): Promise<cwpOperationStatus> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const op = await OperationsService.cwpgetOperationStatus(operationId);
    console.log(`[${attempt}/${MAX_POLL_ATTEMPTS}] status=${op.Status}`);

    if (op.Status === cwpStatus.SUCCEEDED || op.Status === cwpStatus.FAILED) {
      return op;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Timeout waiting for operation');
}

export async function main() {
  const caip19 = env('IV_CAIP19', DEFAULT_CAIP19);
  const testNetwork = env('IV_TEST_NETWORK', 'true') !== 'false';
  const initiatorId = env('IV_INITIATOR_ID') || undefined;
  const explorerBase = env('IV_EXPLORER_TX_URL', DEFAULT_EXPLORER_TX);
  const amountWei = BigInt(env('IV_MINT_AMOUNT_WEI', MINT_AMOUNT_WEI));

  console.log('EVM ERC-20 mint via CWP makeTransaction');
  console.log(`  Source:          ${WITHDRAWAL_ADDRESS}`);
  console.log(`  Token contract:  ${TOKEN_CONTRACT_ADDRESS}`);
  console.log(`  Mint to:         ${RECEIVER_ADDRESS}`);
  console.log(`  Amount (wei):    ${amountWei.toString()}`);
  console.log(`  CAIP-19:         ${caip19}`);
  console.log(`  TestNetwork:     ${testNetwork}\n`);

  const calldata = buildMintCalldata(RECEIVER_ADDRESS, amountWei);
  console.log(`Calldata: ${calldata}\n`);

  const request = buildMintRequest(calldata, { caip19, testNetwork, initiatorId });
  console.log('Request body:', JSON.stringify(request, null, 2));

  const { OperationID } = await TransactionsService.cwpstartMakeTransaction(request);
  console.log(`OperationID: ${OperationID}\n`);

  const op = await waitForTerminalStatus(OperationID);
  if (op.Status === cwpStatus.FAILED) {
    console.error('Operation failed:', op.ErrorDetails);
    process.exit(1);
  }

  const result: cwpResult | undefined = op.Result;
  const tx: cwpTransaction | undefined = result?.Transaction;
  const txHash = tx?.ID;
  console.log('Result.Transaction:', JSON.stringify(tx, null, 2));

  if (txHash) {
    const base = explorerBase.endsWith('/') ? explorerBase : `${explorerBase}/`;
    console.log(`Explorer: ${base}${txHash}`);
  } else {
    console.log('Succeeded but no transaction id/hash on Result.Transaction');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
