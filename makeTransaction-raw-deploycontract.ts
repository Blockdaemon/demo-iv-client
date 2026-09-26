import {
  TransactionsService,
  OpenAPI,
  cwpStatus,
  type cwpMakeTransactionStartRequest,
  type cwpResult,
  type cwpTransaction,
} from './iv-sdk-typescript';
import {
  createPublicClient,
  encodeDeployData,
  http,
  serializeTransaction,
  type Hex,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { compileDepositToken } from './lib/compileDepositToken';
import { env, requireEnv } from './lib/env';
import { waitForOperation } from './lib/waitForOperation';

function createEvmClient(): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(env('EVM_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com')),
  });
}

function asHex(signedTransaction: string): Hex {
  return (signedTransaction.startsWith('0x') ? signedTransaction : `0x${signedTransaction}`) as Hex;
}

async function broadcastSignedTransaction(signedTransaction: string): Promise<Hex> {
  const client = createEvmClient();
  return client.sendRawTransaction({ serializedTransaction: asHex(signedTransaction) });
}

async function buildUnsignedDeployTx(from: string): Promise<Hex> {
  const client = createEvmClient();
  const { abi, bytecode } = compileDepositToken();
  const deployData = encodeDeployData({
    abi,
    bytecode,
    args: [from],
  });

  const nonce = await client.getTransactionCount({ address: from as `0x${string}` });
  const gas = await client.estimateGas({ account: from as `0x${string}`, data: deployData, value: 0n });
  const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas();

  return serializeTransaction({
    chainId: sepolia.id,
    nonce,
    value: 0n,
    gas,
    maxFeePerGas: maxFeePerGas!,
    maxPriorityFeePerGas: maxPriorityFeePerGas!,
    accessList: [],
    type: 'eip1559',
    data: deployData,
  });
}

function buildDeployRequest(
  rawTransaction: string,
  opts: { caip19: string; sourceAddress: string; initiatorId?: string },
): cwpMakeTransactionStartRequest {
  return {
    CAIP19: opts.caip19,
    Source: { Address: opts.sourceAddress },
    RawTransaction: rawTransaction,
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

  console.log('Compiling contracts/NewBankDepositToken.sol with solc...');
  console.log('EVM deposit token deploy via CWP makeTransaction (sign RawTransaction, then broadcast locally)');
  console.log(`  Source/owner:  ${sourceAddress}`);
  console.log(`  CAIP-19:       ${caip19}`);

  const rawHex = await buildUnsignedDeployTx(sourceAddress);
  console.log(`Unsigned tx (hex): ${rawHex.slice(0, 66)}... (${rawHex.length} chars)\n`);

  const request = buildDeployRequest(rawHex, { caip19, sourceAddress, initiatorId });
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
  console.log('Result.Transaction:', JSON.stringify(tx, null, 2));

  const signedTx = tx?.SignedTransaction;
  if (!signedTx) {
    throw new Error('Operation succeeded but Result.Transaction.SignedTransaction is missing');
  }

  console.log(`\nBroadcasting signed tx (${signedTx.slice(0, 66)}...)...`);
  const txHash = await broadcastSignedTransaction(signedTx);
  console.log(`Broadcast tx hash: ${txHash}`);

  const client = createEvmClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (!receipt.contractAddress) {
    throw new Error(`Transaction ${txHash} confirmed without a contract address`);
  }

  const base = explorerBase.endsWith('/') ? explorerBase : `${explorerBase}/`;
  console.log(`Explorer: ${base}${txHash}`);
  console.log(`Contract address: ${receipt.contractAddress}`);
  console.log(`Set IV_TOKEN_CONTRACT_ADDRESS=${receipt.contractAddress}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
