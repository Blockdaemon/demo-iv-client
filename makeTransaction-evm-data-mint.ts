import {
  TransactionsService,
  OpenAPI,
  cwpStatus,
  type cwpMakeTransactionStartRequest,
  type cwpResult,
  type cwpTransaction,
} from './iv-sdk-typescript';
import { encodeFunctionData, parseAbi } from 'viem';
import { env, requireEnv } from './lib/env';
import { waitForOperation } from './lib/waitForOperation';

function buildMintCalldata(to: string, amountWei: bigint): string {
  const abi = parseAbi(['function mint(address to, uint256 amount)']);
  return encodeFunctionData({
    abi,
    functionName: 'mint',
    args: [to as `0x${string}`, amountWei],
  });
}

function buildMintRequest(
  calldata: string,
  opts: { caip19: string; sourceAddress: string; tokenContract: string; initiatorId?: string },
): cwpMakeTransactionStartRequest {
  return {
    CAIP19: opts.caip19,
    Source: { Address: opts.sourceAddress },
    Destination: [{ Address: opts.tokenContract, Amount: '0' }],
    EVM: { Data: calldata },
    ...(opts.initiatorId ? { InitiatorID: opts.initiatorId } : {}),
  };
}

export async function main() {
  OpenAPI.BASE = requireEnv('IV_API_BASE_URL');
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');

  const caip19 = env('IV_CAIP19', 'eip155:11155111/slip44:60');
  const initiatorId = process.env.IV_INITIATOR_ID || undefined;
  const explorerBase = env('IV_EXPLORER_TX_URL', 'https://sepolia.etherscan.io/tx/');
  const sourceAddress = requireEnv('IV_SOURCE_ADDRESS');
  const tokenContract = requireEnv('IV_TOKEN_CONTRACT_ADDRESS');
  const receiverAddress = requireEnv('IV_RECEIVER_ADDRESS');
  const amountWei = BigInt(env('IV_MINT_AMOUNT_WEI', '40000000000000000000'));

  console.log('EVM ERC-20 mint via CWP makeTransaction');
  console.log(`  Source:          ${sourceAddress}`);
  console.log(`  Token contract:  ${tokenContract}`);
  console.log(`  Mint to:         ${receiverAddress}`);
  console.log(`  Amount (wei):    ${amountWei.toString()}`);
  console.log(`  CAIP-19:         ${caip19}\n`);

  const calldata = buildMintCalldata(receiverAddress, amountWei);
  console.log(`Calldata: ${calldata}\n`);

  const request = buildMintRequest(calldata, { caip19, sourceAddress, tokenContract, initiatorId });
  console.log('Request body:', JSON.stringify(request, null, 2));

  const { OperationID } = await TransactionsService.cwpstartMakeTransaction(request);
  console.log(`OperationID: ${OperationID}\n`);

  const op = await waitForOperation(OperationID);
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
