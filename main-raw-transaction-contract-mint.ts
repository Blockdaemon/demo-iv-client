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
import { hoodi } from 'viem/chains';

declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const WITHDRAWAL_ADDRESS = '0x90f0d5881a99839F5ee62ecd054890f1Bb37afFD';
const RECEIVER_ADDRESS = '0x17aFf849127Eec33ee8651cafae58900c8B36bA2';
const CONTRACT_ADDRESS = '0xb6f917b19d0efa25644a6f0b834c23da6472e758';  //BD1404
const ASSET_ID = 12; // HOODI
const MINT_AMOUNT = '40';

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://demo.localtunnel.prd.wallet.blockdaemon.app';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);

const HOODI_RPC = 'https://ethereum-hoodi-rpc.publicnode.com';

function buildMintCalldata(receiverAddress: `0x${string}`, amount: string): Hex {
  const abi = parseAbi(['function mint(address to, uint256 amount)']);
  const amountInWei = parseEther(amount); // BD1404 uses 18 decimals
  const calldata = encodeFunctionData({
    abi,
    functionName: 'mint',
    args: [receiverAddress, amountInWei],
  });
  console.log(`✅ Generated mint calldata: ${calldata}`);
  return calldata;
}

async function buildUnsignedMintTxHex(params: {
  fromAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  receiverAddress: `0x${string}`;
  amount: string;
}): Promise<{ unsignedHex: Hex; tx: any }> {
  const client = createPublicClient({
    chain: hoodi,
    transport: http(HOODI_RPC),
  });

  const calldata = buildMintCalldata(params.receiverAddress, params.amount);

  const nonce = await client.getTransactionCount({ address: params.fromAddress });
  const gas = await client.estimateGas({
    account: params.fromAddress,
    to: params.contractAddress,
    value: 0n,
    data: calldata,
  });
  const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas();

  const txEip1559 = {
    chainId: hoodi.id,
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
    const { unsignedHex } = await buildUnsignedMintTxHex({
      fromAddress: fromAddress as `0x${string}`,
      contractAddress: CONTRACT_ADDRESS as `0x${string}`,
      receiverAddress: RECEIVER_ADDRESS as `0x${string}`,
      amount: MINT_AMOUNT,
    });

    const requestBody: RawTransferPost = {
      protocol: Protocol.ETHEREUM,
      network: Network.HOODI,
      symbol: 'ETH',
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
  console.log('🚀 Starting BD1404 raw mint...');
  console.log(`📋 Configuration:`);
  console.log(`  - BD1404 Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  - Mint Amount: ${MINT_AMOUNT} tokens`);
  console.log(`  - Mint To (receiver): ${RECEIVER_ADDRESS}`);
  console.log(`  - From (owner/signer): ${WITHDRAWAL_ADDRESS}`);
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
        chain: hoodi,
        transport: http(HOODI_RPC),
      });

      const serialized = result.signedTransaction.startsWith('0x')
        ? (result.signedTransaction as Hex)
        : (`0x${result.signedTransaction}` as Hex);

      const txHash = await client.sendRawTransaction({ serializedTransaction: serialized });
      console.log(`🔗 tx hash: ${txHash}`);
      console.log(`🔗 View on Etherscan: https://hoodi.etherscan.io/tx/${txHash}`);
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
