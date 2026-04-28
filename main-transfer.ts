import { 
  AccountsService, 
  TransactionsService,
  EventsService,
  OpenAPI,
  TransferPost,
  Account,
  AccountAsset,
  Address,
} from './iv-sdk-typescript';

// Node globals (for TS without @types/node in scope)
declare const process: any;
declare const require: any;
declare const module: any;

// Configuration
const WITHDRAWAL_ADDRESS = '0x9E5ABB1E0c681bEAEF3DC853f83ABF8328DbDF41';
const RECEIVER_ADDRESS = '0x3f75fE68752f6A127e8D73a697D210148E4D75e8';
const ASSET_ID = 12; // ETH
const WITHDRAW_AMOUNT = '0.5';

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://americas-sales-team-1.api.blockdaemon-wallet.com';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.IV_API_KEY);

async function findAccountByWalletAddress(walletAddress: string, assetID: number): Promise<{account: Account, matchedAsset: AccountAsset, matchedAddress: Address}> {  
  const response = await AccountsService.listAccounts();
  
  if ('code' in response) {
    throw new Error(`API Error: ${response.message}`);
  }
  
  if (response.list.length === 0) {
    throw new Error('No accounts found in wallet');
  }
  
  for (const account of response.list) {
    if (!account.config?.assets || account.config.assets.length === 0) {
      continue;
    }
    
    const targetAsset = account.config.assets.find((asset) =>
      (asset.asset?.metadata as any)?.id === assetID
    );
    
    if (!targetAsset || targetAsset.addresses.length === 0) {
      continue;
    }
    
    const targetAddress = targetAsset.addresses.find((addr) =>
      addr.config?.address?.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (targetAddress) {
      const assetName = (targetAsset.asset?.metadata as any)?.name;
      if (!assetName) {
        throw new Error(`Asset name not found for asset ID: ${assetID}`);
      }

      console.log(`📊 Account: ${(account.metadata as any)?.name}`);
      console.log(`💰 Asset: ${assetName} (ID: ${assetID})`);
      console.log(`🔗 Protocol: ${targetAddress.config.protocol}`);
      console.log(`🌐 Network: ${targetAddress.config.network}`);
      console.log(`💵 Balance: ${targetAsset.balance?.crypto?.value?.available || '0'} ${targetAsset.balance?.crypto?.unit || ''}`);
      
      return { account, matchedAsset: targetAsset, matchedAddress: targetAddress };
    }
  }
  
  throw new Error(`No account found with asset ID ${assetID} and wallet address: ${walletAddress}`);
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
      reference: 'transfer ref:abc123'
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
  return TransactionsService.getTransaction(transactionId);
}

async function monitorTransaction(transactionId: number): Promise<string | null> {
  console.log('👀 Monitoring transaction events...');
  
  const maxAttempts = 40;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const events = await EventsService.listEvents() as any;
      
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
  console.log('🚀 Starting transfer...');
  console.log(`📋 Configuration:`);
  console.log(`  - Amount: ${WITHDRAW_AMOUNT}`);
  console.log(`  - Asset ID: ${ASSET_ID}`);
  console.log(`  - Withdrawal Address: ${WITHDRAWAL_ADDRESS}`);
  console.log(`  - Receiver Address: ${RECEIVER_ADDRESS}`);
  console.log('');
  
  try {
    // Step 1: Find account by wallet address and asset ID, and get balance info
    await findAccountByWalletAddress(WITHDRAWAL_ADDRESS, ASSET_ID);
    console.log('');
    
    // Step 2: Create transfer
    const transfer = await createTransfer(WITHDRAWAL_ADDRESS, RECEIVER_ADDRESS, WITHDRAW_AMOUNT, ASSET_ID);
    const transferId = transfer.metadata?.id?.toString() || transfer.ID?.toString() || 'unknown';
    
    // Step 3: Monitor transaction
    const txHash = await monitorTransaction(parseInt(transferId));
    console.log(`🔗 Transaction Hash: ${txHash}`);
    
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
