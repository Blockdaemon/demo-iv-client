import { 
  TransactionsService,
  OperationsService,
  OpenAPI,
  Protocol,
  Network,
  type RawTransferPost,
} from './iv-sdk-typescript';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
  serializeTransaction,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';

declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const WITHDRAWAL_ADDRESS = '0x90f0d5881a99839F5ee62ecd054890f1Bb37afFD';
const CONTRACT_ADDRESS = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'; 
const BURN_AMOUNT = '3';

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://demo.localtunnel.prd.wallet.blockdaemon.app';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.IV_API_KEY);

const BASE_SEPOLIA_RPC = 'https://base-sepolia-rpc.publicnode.com';

function buildBurnCalldata(amount: string): Hex {
  const abi = parseAbi(['function burn(uint256 amount)']);
  const amountInWei = parseEther(amount);
  const calldata = encodeFunctionData({
    abi,
    functionName: 'burn',
    args: [amountInWei],
  });
  console.log(`✅ Generated burn calldata: ${calldata}`);
  return calldata;
}

async function buildUnsignedBurnTxHex(params: {
  fromAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  amount: string;
}): Promise<{ unsignedHex: Hex; tx: any }> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC),
  });

  const calldata = buildBurnCalldata(params.amount);

  const nonce = await client.getTransactionCount({ address: params.fromAddress });
  const gas = await client.estimateGas({
    account: params.fromAddress,
    to: params.contractAddress,
    value: 0n,
    data: calldata,
  });
  const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas();

  const txEip1559 = {
    chainId: baseSepolia.id,
    nonce,
    to: params.contractAddress,
    value: 0n,
    gas,
    maxFeePerGas: maxFeePerGas!,
    maxPriorityFeePerGas: maxPriorityFeePerGas!,
    accessList: [],
    type: 'eip1559' as const,
    data: calldata,
  };

  const unsignedHex = serializeTransaction(txEip1559);
  console.log(`🧾 Unsigned Transaction: ${unsignedHex}`);
  return { unsignedHex, tx: txEip1559 };
}

async function createRawTransfer(fromAddress: string): Promise<{ asyncOperationID: string; operationId: string }> {
  try {
    const { unsignedHex } = await buildUnsignedBurnTxHex({
      fromAddress: fromAddress as `0x${string}`,
      contractAddress: CONTRACT_ADDRESS as `0x${string}`,
      amount: BURN_AMOUNT,
    });

    const requestBody: RawTransferPost = {
      protocol: Protocol.BASE,
      network: Network.SEPOLIA,
      symbol: 'BASE-ETH',
      fromAddress,
      rawTransaction: unsignedHex,
    };

    const response = await TransactionsService.createRawTransfer(requestBody) as any;
    const asyncOperationID = response?.asyncOperationID || response?.operationID || response?.id;
    if (!asyncOperationID) {
      throw new Error('Missing asyncOperationID in RawTransferResponse');
    }
    console.log(`✅ Raw transfer submitted. Async Operation ID: ${asyncOperationID}`);
    return { asyncOperationID, operationId: asyncOperationID };
  } catch (error) {
    console.error('❌ Error creating raw transfer:', error);
    throw error;
  }
}

async function waitForOperationToFinish(operationId: string): Promise<{ transactionId?: number; signedTransaction?: string } | null> {
  console.log('👀 Monitoring async operation status...');
  
  const maxAttempts = 30;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const op = await OperationsService.getMpaOperationById(operationId as any);
      if ('error' in (op as any)) {
        throw new Error(`Operations API Error: ${(op as any).error}`);
      }
      const state = op as any;
      console.log(`  - Operation state: ${JSON.stringify(state)}`);
      const status = state.Status || state.status;

      if (status === 'fin') {
        const outputs = state.Outputs || state.outputs;
        const tx = outputs?.Transaction || outputs?.transaction;
        const txIdRaw = tx?.ID || tx?.id;
        const transactionId = txIdRaw ? parseInt(txIdRaw, 10) : undefined;
        const signedTransaction = tx?.SignedTransaction || tx?.signedTransaction;
        return { transactionId, signedTransaction };
      }
      if (status === 'err' || status === 'rej' || status === 'can') {
        console.error('❌ Operation ended in non-success state:', state.errorDetails || status);
        return null;
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error monitoring operation (attempt ${attempts}):`, error);
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('⏰ Timeout reached while monitoring operation');
  return null;
}

async function main() {
  console.log('🚀 Starting USDC raw burn...');
  console.log(`📋 Configuration:`);
  console.log(`  - USDC Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  - Burn Amount: ${BURN_AMOUNT} tokens`);
  console.log(`  - From (token holder/signer): ${WITHDRAWAL_ADDRESS}`);
  console.log('');
  
  try {
    const { operationId } = await createRawTransfer(WITHDRAWAL_ADDRESS);

    const result = await waitForOperationToFinish(operationId);
    if (!result) {
      throw new Error('Operation did not complete successfully');
    }

    if (result.signedTransaction) {
      console.log(`\n🧾 Signed Transaction: ${result.signedTransaction}`);

      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(BASE_SEPOLIA_RPC),
      });

      const serialized = result.signedTransaction.startsWith('0x')
        ? (result.signedTransaction as Hex)
        : (`0x${result.signedTransaction}` as Hex);

      const txHash = await client.sendRawTransaction({ serializedTransaction: serialized });
      console.log(`🔗 tx hash: ${txHash}`);
      console.log(`🔗 View on BaseScan: https://sepolia.basescan.org/tx/${txHash}`);
    }
    
  } catch (error) {
    console.error('💥 Error in main process:', error);
    if (typeof process !== 'undefined') {
      process.exit(1);
    }
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch(console.error);
}

export { main };
