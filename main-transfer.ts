import { 
  AccountsService, 
  TransactionsService,
  EventsService,
  OpenAPI,
  TransferPost,
} from './iv-sdk-typescript';

// Node globals (for TS without @types/node in scope)
declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const WITHDRAWAL_ADDRESS = '0xDbAfFC0756a4AB9620d46052788c8c17b172414D';
const RECEIVER_ADDRESS = '0x52b09e2c73849B25F9b0328e2d4b444e9bd1EF30';
const ASSET_ID = 13; // ETH
const WITHDRAW_AMOUNT = '0.0001';

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://demo.localtunnel.prd.wallet.blockdaemon.app';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);

async function findAccountByWalletAddress(walletAddress: string): Promise<{account: any, ethAsset: any, ethAddress: any}> {  
  try {
    // Get all accounts
    const response = await AccountsService.listAccounts();
    
    // Handle the union type response
    if ('error' in response) {
      throw new Error(`API Error: ${response.error}`);
    }
    
    const accountList = response as any;
    
    if (!accountList.list || accountList.list.length === 0) {
      throw new Error(`No accounts found in wallet`);
    }
    
    // Search through all accounts to find the one with the matching wallet address
    for (const account of accountList.list) {
      if (!account.config?.assets || account.config.assets.length === 0) {
        continue;
      }
      
      // Find the Ethereum asset by protocol
      const ethAsset = account.config.assets.find((asset: any) => 
        asset.asset?.config?.protocol === 'ethereum' || 
        asset.addresses?.some((addr: any) => addr.config?.protocol === 'ethereum')
      );
      
      if (!ethAsset || !ethAsset.addresses || ethAsset.addresses.length === 0) {
        continue;
      }
      
      // Find the Ethereum address that matches our target wallet address
      const ethAddress = ethAsset.addresses.find((addr: any) => 
        addr.config?.protocol === 'ethereum' && 
        addr.config?.address?.toLowerCase() === walletAddress.toLowerCase()
      );
      
      if (ethAddress) {
        console.log(`📊 Account: ${account.metadata?.name || account.metadata?.id}`);
        console.log(`💰 ETH Asset: ${ethAsset.asset?.metadata?.name || 'ETH'} (ID: ${ethAsset.asset?.metadata?.id})`);
        console.log(`🌐 Network: ${ethAddress.config.network}`);
        console.log(`🔗 Protocol: ${ethAddress.config.protocol}`);
        console.log(`💵 Balance: ${ethAsset.balance?.crypto?.value?.available || '0'} ${ethAsset.balance?.crypto?.unit || 'ETH'}`);
        
        return { account, ethAsset, ethAddress };
      }
    }
    
    throw new Error(`No account found with wallet address: ${walletAddress}`);
  } catch (error) {
    console.error('❌ Error finding account by wallet address:', error);
    throw error;
  }
}

async function createTransfer(fromAddress: string, receiverAddress: string, amount: string, assetID: number): Promise<any> {
  try {
    const transferPost: TransferPost = {
      type: TransferPost.type.TRANSFER,
      assetID: assetID,
      toAddressAmountArray: [
        {
          address: receiverAddress,
        }
      ],
      fromAddressAmountArray: [
        {
          address: fromAddress,
          amount: amount,
        }
      ],
      reference: 'ETH transfer ref:abc123'
    };
    
    const transfer = await TransactionsService.createTransfer(transferPost) as any;
    console.log(`✅ Transfer created with ID: ${transfer.ID.toString()}`);
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
  
  const maxAttempts = 10;
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
  console.log('🚀 Starting ETH transfer...');
  console.log(`📋 Configuration:`);
  console.log(`  - Amount: ${WITHDRAW_AMOUNT} ETH`);
  console.log(`  - Receiver Address: ${RECEIVER_ADDRESS}`);
  console.log('');
  
  try {
    // Step 1: Find account by wallet address and get balance info
    const { account, ethAsset, ethAddress } = await findAccountByWalletAddress(WITHDRAWAL_ADDRESS);
    console.log('');
    
    // Step 2: Create transfer
    const transfer = await createTransfer(WITHDRAWAL_ADDRESS, RECEIVER_ADDRESS, WITHDRAW_AMOUNT, ASSET_ID);
    const transferId = transfer.metadata?.id?.toString() || transfer.ID?.toString() || 'unknown';
    
    // Step 3: Monitor transaction
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
