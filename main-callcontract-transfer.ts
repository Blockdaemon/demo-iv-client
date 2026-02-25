import { 
  TransactionsService,
  EventsService,
  OpenAPI,
  TransferPost,
} from './iv-sdk-typescript';
import { encodeFunctionData, parseAbi, parseEther, parseUnits } from 'viem';

// Node globals (for TS without @types/node in scope)
declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const WITHDRAWAL_ADDRESS = '0xdae9d8CdCEAF02b55CEc47C37F379087E069e496';
const RECEIVER_ADDRESS = '0x42468CF04896D579323E33F7eEbCf3d88064270a';
const Blockdaemon_CONTRACT_ADDRESS = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';  //BD1404
const ASSET_ID = 16; // ETH
const WITHDRAW_AMOUNT = '0.5'; // BD1404 token

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://demo.localtunnel.prd.wallet.blockdaemon.app';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY) || '';

function createTransferCalldata(receiverAddress: string): string {
  try {
    // Standard ERC20 transfer function: transfer(address to, uint256 amount)
    const abi = parseAbi([
      'function transfer(address to, uint256 amount)'
    ]);
    
    // Convert amount to wei using viem helper (assumes 18 decimals)
    //const amountInWei = parseEther(WITHDRAW_AMOUNT);
    const amountInWei = parseUnits(WITHDRAW_AMOUNT, 6);
    
    const calldata = encodeFunctionData({
      abi,
      functionName: 'transfer',
      args: [receiverAddress as `0x${string}`, amountInWei]
    });
    
    console.log(`✅ Generated calldata - function transfer(address to, uint256 amount): ${calldata}`);
    return calldata;
  } catch (error) {
    console.error('❌ Error creating calldata:', error);
    throw error;
  }
}

async function createTransfer(calldata: string, fromAddress: string): Promise<any> {
  try {
    const transferPost: TransferPost = {
      type: TransferPost.type.CONTRACT,
      assetID: ASSET_ID,
      toAddressAmountArray: [
        {
          address: Blockdaemon_CONTRACT_ADDRESS,
          calldata: calldata
        }
      ],
      fromAddressAmountArray: [
        {
          address: fromAddress,
          amount: "0",
        }
      ],
      blockchainSpec: {
        evm: {
          Gas: "95000",
        }
      },
      reference: 'BD1404 transfer ref:abc123'
    };
    
    const transfer = await TransactionsService.createTransfer(transferPost) as any;
    console.log(`✅ Transfer created with ID: ${transfer.ID}`);
    return transfer;
  } catch (error) {
    console.error('❌ Error creating transfer:', error);
    throw error;
  }
}

async function getTransactionStatus(transactionId: number): Promise<any> {
  try {
    const response = await TransactionsService.getTransaction(transactionId);
    
    // Handle the union type response
    if ('error' in response) {
      throw new Error(`API Error: ${response.error}`);
    }
    
    const transaction = response as any;
    
    return transaction;
  } catch (error) {
    console.error(`❌ Error getting transaction status:`, error);
    throw error;
  }
}

async function monitorTransaction(transactionId: number): Promise<string | null> {
  console.log('👀 Monitoring transaction events...');
  
  const maxAttempts = 10; // 5 minutes with 10-second intervals
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      // Get events from Events API
      const eventsResponse = await EventsService.listEvents();
      
      // Handle the union type response
      if ('error' in eventsResponse) {
        throw new Error(`Events API Error: ${eventsResponse.error}`);
      }
      
      const events = eventsResponse as any;
      
      // Filter events for this specific transaction
      const transactionEvents = events.list.filter((event: any) => 
        event.status?.apiResourceID === transactionId && 
        event.status?.apiResourceType === 'transaction'
      );
      
      // Log topic values for this transaction ID
      if (transactionEvents.length > 0) {
        console.log(`📊 Transaction ${transactionId} events:`);
        transactionEvents.forEach((event: any) => {
          console.log(`  - Topic: ${event.status?.topic || 'Unknown'}`);
        });
        
        // Check if we have a TransactionStable event
        const stableEvent = transactionEvents.find((event: any) => 
          event.status?.topic === 'TransactionStable'
        );
        
        if (stableEvent) {
          // Now get the transaction details to get the txHash
          const transaction = await getTransactionStatus(transactionId);
          const txHash = transaction.status?.txHash;
          
          if (txHash) {
            return txHash;
          } else {
            console.log('⚠️ TransactionStable event received but no hash found');
            return null;
          }
        }
      } else {
        console.log(`📊 No events found for transaction ${transactionId}`);
      }
      
      attempts++;
      console.log(`⏳ Waiting for transaction events... (${attempts}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      
    } catch (error) {
      console.error(`❌ Error monitoring transaction events (attempt ${attempts}):`, error);
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log('⏰ Timeout reached while monitoring transaction events');
  return null;
}

async function main() {
  console.log('🚀 Starting ERC1404 transfer...');
  console.log(`📋 Configuration:`);
  console.log(`  - BD1404 Token Contract: ${Blockdaemon_CONTRACT_ADDRESS}`);
  console.log(`  - Amount: ${WITHDRAW_AMOUNT} ETH`);
  console.log(`  - Asset ID: ${ASSET_ID}`);
  console.log('');
  
  try {
    
    // Step 2: Create transfer calldata using IV wallet as receiver
    const calldata = createTransferCalldata(RECEIVER_ADDRESS);
      
    // Step 3: Create transfer
    const transfer = await createTransfer(calldata, WITHDRAWAL_ADDRESS);
    console.log(`✅ Transfer created with ID: ${JSON.stringify(transfer)}`);
    const transferId = transfer.ID?.toString();
    
    // Step 4: Monitor transaction
    const txHash = await monitorTransaction(parseInt(transferId));
    console.log(`🔗 View on Etherscan: https://hoodi.etherscan.io/tx/${txHash}`);
    
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
