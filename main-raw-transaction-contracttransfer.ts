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
  parseUnits,
  serializeTransaction,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';

// Node globals (for TS without @types/node in scope)
declare const process: any;
declare const require: any;
declare const module: any;

// Configuration



const WITHDRAWAL_ADDRESS = '0x3f75fE68752f6A127e8D73a697D210148E4D75e8';
const RECEIVER_ADDRESS = '0xe04B031223A1D3c9AC5cfDfe3364b356d98970dC';
const USDC_CONTRACT_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WITHDRAW_AMOUNT = '0.00001';



OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://americas-sales-team-1.api.blockdaemon-wallet.com';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);

function buildErc20TransferCalldata(receiverAddress: `0x${string}`, amount: string): Hex {
  const abi = parseAbi(['function transfer(address to, uint256 amount)']);
  const amountInSmallestUnit = parseUnits(amount, 6); // USDC = 6 decimals
  const calldata = encodeFunctionData({
    abi,
    functionName: 'transfer',
    args: [receiverAddress, amountInSmallestUnit],
  });
  console.log(`✅ Generated ERC20 transfer calldata: ${calldata}`);
  return calldata;
}

async function buildUnsignedErc20TransferHex(params: {
  fromAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  receiverAddress: `0x${string}`;
  amount: string;
}): Promise<{ unsignedHex: Hex; tx: any }> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http('https://sepolia.base.org'),
  });

  const calldata = buildErc20TransferCalldata(params.receiverAddress, params.amount);

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

async function createRawTransfer(fromAddress: string, receiverAddress: string, amount: string): Promise<{ asyncOperationID: string, operationId: string }> {
  try {
    const { unsignedHex } = await buildUnsignedErc20TransferHex({
      fromAddress: fromAddress as `0x${string}`,
      contractAddress: USDC_CONTRACT_ADDRESS as `0x${string}`,
      receiverAddress: receiverAddress as `0x${string}`,
      amount,
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
  console.log('🚀 Starting ERC20 USDC raw transfer...');
  console.log(`📋 Configuration:`);
  console.log(`  - USDC Contract: ${USDC_CONTRACT_ADDRESS}`);
  console.log(`  - Amount: ${WITHDRAW_AMOUNT} USDC`);
  console.log(`  - Receiver Address: ${RECEIVER_ADDRESS}`);
  console.log('');
  
  try {
    // Step 1: Create raw transfer using unsigned tx hex
    const { operationId } = await createRawTransfer(WITHDRAWAL_ADDRESS, RECEIVER_ADDRESS, WITHDRAW_AMOUNT);

    // Step 2: Wait for operation to finish and get transaction ID / signed tx
    const result = await waitForOperationToFinish(operationId);
    if (!result) {
      throw new Error('Operation did not complete successfully');
    }

    if (result.signedTransaction) {
      console.log(`\n🧾 Signed Transaction: ${result.signedTransaction}`);

      // Broadcast the signed transaction to RPC
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const serialized = result.signedTransaction.startsWith('0x')
        ? (result.signedTransaction as Hex)
        : (`0x${result.signedTransaction}` as Hex);

      const txHash = await client.sendRawTransaction({ serializedTransaction: serialized });
      console.log(`🔗 tx hash: ${txHash}`);
    }
    
  } catch (error) {
    console.error('💥 Error in main process:', error);
    if (typeof process !== 'undefined') {
      process.exit(1);
    }
  }
}

// Run the application
if (typeof require !== 'undefined' && require.main === module) {
  main().catch(console.error);
}

export { main };
