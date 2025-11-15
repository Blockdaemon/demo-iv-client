import { 
  AccountsService,
  TransactionsService,
  EventsService,
  OpenAPI,
  TransferPost,
} from './iv-sdk-typescript';
import { encodeFunctionData, parseAbi } from 'viem';

// Node globals (for TS without @types/node in scope)
declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const Blockdaemon_CONTRACT_ADDRESS = '0xD704bBe7f20A6aB2cfCA03a404380B340ad6F1cb';
const REFERRER_ADDRESS = '0x0000000000000000000000000000000000000000';
const ACCOUNT_ID = 1;
const ASSET_ID = 12; // ETH
const DEPOSIT_AMOUNT = '0.1'; // ETH

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://demo.localtunnel.prd.wallet.blockdaemon.app';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY) as string;

async function getIVWalletAddress(): Promise<string> {
  console.log('🔍 Getting IV wallet address...');
  
  try {
    const response = await AccountsService.getAccount(ACCOUNT_ID);
    
    // Handle the union type response
    if ('error' in response) {
      throw new Error(`API Error: ${response.error}`);
    }
    
    const account = response as any;
    
    if (!account.config?.assets || account.config.assets.length === 0) {
      throw new Error(`No assets found for account ID ${ACCOUNT_ID}`);
    }
    
    // Find the Ethereum asset by protocol
    const ethAsset = account.config.assets.find((asset: any) => 
      asset.asset?.config?.protocol === 'ethereum' || 
      asset.addresses?.some((addr: any) => addr.config?.protocol === 'ethereum')
    );
    
    if (!ethAsset) {
      throw new Error(`Ethereum asset not found in account ${ACCOUNT_ID}`);
    }
    
    if (!ethAsset.addresses || ethAsset.addresses.length === 0) {
      throw new Error(`No addresses found for Ethereum asset in account ${ACCOUNT_ID}`);
    }
    
    // Find the Ethereum address (where protocol = ethereum)
    const ethAddress = ethAsset.addresses.find((addr: any) => 
      addr.config?.protocol === 'ethereum'
    );
    
    if (!ethAddress) {
      throw new Error(`No Ethereum address found in account ${ACCOUNT_ID}`);
    }
    
    const walletAddress = ethAddress.config.address;
    console.log(`✅ IV wallet address: ${walletAddress}`);
    console.log(`📊 Account: ${account.metadata?.name || account.metadata?.id}`);
    console.log(`💰 ETH Asset: ${ethAsset.asset?.metadata?.name || 'ETH'} (ID: ${ethAsset.asset?.metadata?.id})`);
    console.log(`🌐 Network: ${ethAddress.config.network}`);
    console.log(`🔗 Protocol: ${ethAddress.config.protocol}`);
    console.log(`💵 Balance: ${ethAsset.balance?.crypto?.value?.available || '0'} ${ethAsset.balance?.crypto?.unit || 'ETH'}`);
    return walletAddress;
  } catch (error) {
    console.error('❌ Error getting IV wallet address:', error);
    throw error;
  }
}

function createDepositCalldata(receiverAddress: string): string {
  try {
    // Blockdaemon deposit function: deposit(address receiver, address referrer)
    const abi = parseAbi([
      'function deposit(address receiver, address referrer)'
    ]);
    
    const calldata = encodeFunctionData({
      abi,
      functionName: 'deposit',
      args: [receiverAddress as `0x${string}`, REFERRER_ADDRESS as `0x${string}`]
    });
    
    console.log(`✅ Generated calldata - function deposit(address receiver, address referrer): ${calldata}`);
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
          amount: DEPOSIT_AMOUNT,
        }
      ],
      reference: 'Blockdaemon ETH vault deposit ref:abc123'
    };

    const transfer = await TransactionsService.createTransfer(transferPost) as any;
    console.log(`Transfer created with ID: ${transfer.ID.toString()}`);
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
            console.log(`🔗 View on Etherscan: https://hoodi.etherscan.io/tx/${txHash}`);
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
  console.log('🚀 Starting Blockdaemon Public ETH Vault deposit...');
  console.log(`📋 Configuration:`);
  console.log(`  - Contract: ${Blockdaemon_CONTRACT_ADDRESS}`);
  console.log(`  - Amount: ${DEPOSIT_AMOUNT} ETH`);
  console.log(`  - Account ID: ${ACCOUNT_ID}`);
  console.log(`  - Asset ID: ${ASSET_ID}`);
  console.log('');
  
  try {
    // Step 1: Get IV wallet address (will be used as both from and receiver)
    const ivWalletAddress = await getIVWalletAddress();
    console.log(`  - IV Wallet (from): ${ivWalletAddress}`);
    console.log('');
    
    // Step 2: Create deposit calldata using IV wallet as receiver
    const calldata = createDepositCalldata(ivWalletAddress);
    
    // Step 3: Create transfer
    const transfer = await createTransfer(calldata, ivWalletAddress);
    const transferId = transfer.metadata?.id?.toString() || transfer.ID?.toString() || 'unknown';
    
    // Step 4: Monitor transaction
    const txHash = await monitorTransaction(parseInt(transferId));
    
    if (txHash) {
      console.log(`🔗 Vault: https://app.stakewise.io/vault/hoodi/0xd704bbe7f20a6ab2cfca03a404380b340ad6f1cb`);
    } else {
      console.log('⚠️ Blockdaemon ETH vault deposit process completed, but transaction hash not found.');
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
