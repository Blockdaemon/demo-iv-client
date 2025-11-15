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
  http,
  parseEther,
  serializeTransaction,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';

// Node globals (for TS without @types/node in scope)
declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const WITHDRAWAL_ADDRESS = '0x05E66055CdF2aC0B1f14F43a50Cf7198B6800509';
const RECEIVER_ADDRESS = '0x6372cCbc575573586FE56810bb9907273D979E8a';

const WITHDRAW_AMOUNT = '0.02';

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://demo.localtunnel.prd.wallet.blockdaemon.app';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);

async function buildUnsignedEthTransferHex(params: {
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountEth: string;
}): Promise<{ unsignedHex: Hex; tx: any }> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  const nonce = await client.getTransactionCount({ address: params.fromAddress });
  const value = parseEther(params.amountEth);
  const gas = await client.estimateGas({ account: params.fromAddress, to: params.toAddress, value });
  const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas();

  // Build an EIP-1559 (type 2) transaction and include empty v, r, s
  const txEip1559 = {
    chainId: baseSepolia.id,
    nonce,
    to: params.toAddress,
    value,
    gas,
    maxFeePerGas: maxFeePerGas!,
    maxPriorityFeePerGas: maxPriorityFeePerGas!,
    accessList: [],
    type: 'eip1559' as const,
    data: '0x' as Hex,
  };

  // Pass a dummy signature so the RLP list has 12 elements (v, r, s are zeroed)
  const unsignedHex = serializeTransaction(txEip1559, {
    v: 0n,
    r: '0x0' as Hex,
    s: '0x0' as Hex,
  });
  console.log(`🧾 Unsigned Transaction: ${unsignedHex}`);
  return { unsignedHex, tx: txEip1559 };
}

async function createRawTransfer(fromAddress: string, receiverAddress: string, amount: string): Promise<{ asyncOperationID: string, operationId: string }> {
  try {
    const { unsignedHex } = await buildUnsignedEthTransferHex({
      fromAddress: fromAddress as `0x${string}`,
      toAddress: receiverAddress as `0x${string}`,
      amountEth: amount,
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
  console.log('🚀 Starting Base Sepolia transfer...');
  console.log(`📋 Configuration:`);
  console.log(`  - Amount: ${WITHDRAW_AMOUNT} ETH`);
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

      // Broadcast the signed transaction to Base Sepolia RPC
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const serialized = result.signedTransaction.startsWith('0x')
        ? (result.signedTransaction as Hex)
        : (`0x${result.signedTransaction}` as Hex);

      const txHash = await client.sendRawTransaction({ serializedTransaction: serialized });
      console.log(`🔗 Base Sepolia tx hash: ${txHash}`);
      console.log(`🔗 Base Sepolia explorer: https://sepolia.basescan.org/tx/${txHash}`);
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
