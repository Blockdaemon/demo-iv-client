import {
  AccountsService,
  AddressesService,
  CwpOperationsService,
  OpenAPI,
  Protocol,
  type cwpTransactionIntent,
  type cwpOperationStatus,
  cwpStatus,
} from './iv-sdk-typescript';

declare const process: any;
declare const require: any;
declare const module: any;

// Canton party IDs (set via env or hardcode for your deployment)
const SOURCE_PARTY_ID = 'bd::12200a90bb3a4f4578e221d141c9b256ce2d6cf50692849fb22d8074b1a6751771e6';
const DESTINATION_PARTY_ID = 'bd::1220fc745217e708a58999ee756e6ca21680b68eabfeb7f62e192739b8dac3860b1a';
const TRANSFER_AMOUNT = '1';

// Canton wallet SDK validator / ledger configuration
const VALIDATOR_URL = (typeof process !== 'undefined' && process.env?.VALIDATOR_URL) || 'http://localhost:2000/api/validator';
const LEDGER_CLIENT_URL = (typeof process !== 'undefined' && process.env?.LEDGER_CLIENT_URL) || 'http://localhost:2975';
const SCAN_PROXY_URL = (typeof process !== 'undefined' && process.env?.SCAN_PROXY_URL) || 'http://localhost:2000/api/validator';

// Canton wallet SDK auth (self_signed for local dev)
const CANTON_AUTH_ISSUER = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_ISSUER) || 'https://keycloak.dev.canton.blockdaemon.com/realms/canton-devnet';
const CANTON_AUTH_CLIENT_ID = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_CLIENT_ID) || 'ledger-api-user';
const CANTON_AUTH_CLIENT_SECRET = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_CLIENT_SECRET) || 'unsafe';
const CANTON_AUTH_AUDIENCE = (typeof process !== 'undefined' && process.env?.CANTON_AUTH_AUDIENCE) || 'https://canton.network.global';

// IV API configuration
OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://americas-sales-team-1.api.blockdaemon-wallet.com';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);
const DEFAULT_MASTER_KEY_NAME = 'Default';

// Canton asset identifiers for CC (Amulet)
const CANTON_ASSET = 'CC';
const CANTON_CAIP19 = 'canton:devnet/slip44:6767';


// ---------------------------------------------------------------------------
// Step 1: Resolve a Canton PartyID to IV MasterKeyName + AccountName
// ---------------------------------------------------------------------------

interface ResolvedAddress {
  masterKeyName: string;
  accountName: string;
  addressIndex: number;
}

async function resolvePartyViaV2(partyId: string): Promise<ResolvedAddress> {
  const addressList = await AddressesService.listAddresses() as any;
  const addresses: any[] = addressList?.list || [];

  let matchedAddress: any = null;
  for (const addr of addresses) {
    const config = addr.config || addr;
    if (
      config.address === partyId &&
      (config.protocol === 'canton' || config.protocol === Protocol.CANTON)
    ) {
      matchedAddress = addr;
      break;
    }
  }

  if (!matchedAddress) {
    throw new Error(`No Canton address matching party ID "${partyId}" found in IV`);
  }

  const accountId: number = matchedAddress.config?.accountID ?? matchedAddress.accountID;
  const account = await AccountsService.getAccount(accountId) as any;
  const accountName: string = account?.metadata?.name ?? account?.name;
  if (!accountName) {
    throw new Error(`Could not determine account name for accountID=${accountId}`);
  }

  return {
    masterKeyName: DEFAULT_MASTER_KEY_NAME,
    accountName,
    addressIndex: 0,
  };
}

// ---------------------------------------------------------------------------
// Step 2: Use the Canton wallet SDK to prepare the transfer transaction
// ---------------------------------------------------------------------------

async function prepareCantonTransfer(params: {
  senderPartyId: string;
  recipientPartyId: string;
  amount: string;
}): Promise<{ preparedTransaction: string; preparedTransactionHash: string }> {
  const {
    WalletSDKImpl,
    ClientCredentialOAuthController,
    UnsafeAuthController,
  } = await import('@canton-network/wallet-sdk');

  const sdk = new WalletSDKImpl();

  function jwtSub(token: string): string {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (!payload.sub) throw new Error('JWT missing sub claim');
    return payload.sub as string;
  }

  const isUnsafeAuth = CANTON_AUTH_ISSUER === 'unsafe-auth';
  if (isUnsafeAuth) {
    const auth = new UnsafeAuthController();
    auth.userId = CANTON_AUTH_CLIENT_ID;
    auth.audience = CANTON_AUTH_AUDIENCE;
    auth.unsafeSecret = CANTON_AUTH_CLIENT_SECRET;
    sdk.configure({ authFactory: () => auth });
  } else {
    const configUrl = CANTON_AUTH_ISSUER.replace(/\/$/, '') + '/.well-known/openid-configuration';
    const inner = new ClientCredentialOAuthController(
      configUrl,
      undefined,
      CANTON_AUTH_CLIENT_ID,
      CANTON_AUTH_CLIENT_SECRET,
      CANTON_AUTH_CLIENT_ID,
      CANTON_AUTH_CLIENT_SECRET,
    );
    inner.audience = CANTON_AUTH_AUDIENCE;
    inner.scope = 'daml_ledger_api';

    // Wrap so the SDK uses the JWT `sub` as userId (what the participant knows)
    // rather than the OAuth client_id
    const auth = {
      getUserToken: async () => {
        const ctx = await inner.getUserToken();
        const sub = jwtSub(ctx.accessToken);
        return { userId: sub, accessToken: ctx.accessToken };
      },
      getAdminToken: async () => {
        const ctx = await inner.getAdminToken();
        const sub = jwtSub(ctx.accessToken);
        return { userId: sub, accessToken: ctx.accessToken };
      },
    };
    sdk.configure({ authFactory: () => auth as any });
  }

  sdk.configure({
    ledgerFactory: (userId: string, authTokenProvider: any, isAdmin: boolean) => {
      const { LedgerController } = require('@canton-network/wallet-sdk');
      return new LedgerController(userId, new URL(LEDGER_CLIENT_URL), undefined, isAdmin, authTokenProvider);
    },
    tokenStandardFactory: (userId: string, authTokenProvider: any, isAdmin: boolean) => {
      const { TokenStandardController } = require('@canton-network/wallet-sdk');
      return new TokenStandardController(
        userId,
        new URL(LEDGER_CLIENT_URL),
        new URL(VALIDATOR_URL),
        undefined,
        authTokenProvider,
        isAdmin,
      );
    },
  });

  await sdk.connect();
  await sdk.setPartyId(params.senderPartyId);

  // Amulet/CC uses the scan proxy for transfer factory registry (REGISTRY_URL is for utility tokens only)
  sdk.tokenStandard!.setTransferFactoryRegistryUrl(new URL(`${SCAN_PROXY_URL}/v0/scan-proxy`));

  const [transferCommand, disclosedContracts] = await sdk.tokenStandard!.createTransfer(
    params.senderPartyId,
    params.recipientPartyId,
    params.amount,
    { instrumentId: 'Amulet' },
  );

  const prepared = await sdk.userLedger!.prepareSubmission(
    transferCommand,
    undefined,
    disclosedContracts,
  );

  if (!prepared.preparedTransaction || !prepared.preparedTransactionHash) {
    throw new Error('Ledger prepare did not return preparedTransaction or hash');
  }

  return {
    preparedTransaction: prepared.preparedTransaction,
    preparedTransactionHash: prepared.preparedTransactionHash,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Submit to IV via CWP /operations/start/makeTransaction
// ---------------------------------------------------------------------------

async function submitMakeTransaction(params: {
  source: ResolvedAddress;
  destinationAddress: string;
  amount: string;
  rawTransaction: string;
  txHash: string;
}): Promise<string> {
  const intent: cwpTransactionIntent = {
    InitiatorID: 'gmay@blockdaemon.com',
    Asset: CANTON_ASSET,
    CAIP19: CANTON_CAIP19,
    Source: {
      MasterKeyName: params.source.masterKeyName,
      AccountName: params.source.accountName,
      AddressIndex: params.source.addressIndex,
    },
    Destination: [
      {
        Address: params.destinationAddress,
        Amount: params.amount,
      },
    ],
    RawTransaction: params.rawTransaction,
    TxHash: params.txHash,
  };

  console.log('  Request body:', JSON.stringify(intent, null, 2));

  const resp = await CwpOperationsService.cwpstartMakeTransaction(intent);
  return resp.OperationID;
}

// ---------------------------------------------------------------------------
// Step 4: Poll CWP operation status via IV SDK
// ---------------------------------------------------------------------------

async function waitForOperation(operationId: string): Promise<{ signedTransaction?: string } | null> {
  console.log('  Polling operation status...');

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const op: cwpOperationStatus = await CwpOperationsService.cwpgetOperationStatus(operationId);
      console.log(`  [${i + 1}/${maxAttempts}] status=${op.Status}`);

      if (op.Status === cwpStatus.SUCCEEDED) {
        return { signedTransaction: op.Result?.Transaction?.SignedTransaction };
      }
      if (op.Status === cwpStatus.FAILED) {
        console.error('  Operation failed:', op.ErrorDetails);
        return null;
      }
    } catch (err: any) {
      console.error(`  Poll error (attempt ${i + 1}):`, err.message || err);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.error('  Timeout waiting for operation');
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!SOURCE_PARTY_ID || !DESTINATION_PARTY_ID) {
    console.error('Set SOURCE_PARTY_ID and DESTINATION_PARTY_ID environment variables');
    if (typeof process !== 'undefined') process.exit(1);
    return;
  }

  console.log('Canton CC raw-transaction transfer via IV');
  console.log(`  Source party:      ${SOURCE_PARTY_ID}`);
  console.log(`  Destination party: ${DESTINATION_PARTY_ID}`);
  console.log(`  Amount:            ${TRANSFER_AMOUNT} CC`);
  console.log('');

  // 1. Resolve source party to IV MasterKey / Account
  console.log('Step 1: Resolving source party in IV...');
  const source = await resolvePartyViaV2(SOURCE_PARTY_ID);
  console.log(`  MasterKeyName: ${source.masterKeyName}`);
  console.log(`  AccountName:   ${source.accountName}`);
  console.log(`  AddressIndex:  ${source.addressIndex}`);
  console.log('');

  // 2. Prepare the Canton transfer via the Canton wallet SDK
  console.log('Step 2: Preparing Canton transfer with wallet SDK...');
  const { preparedTransaction, preparedTransactionHash } = await prepareCantonTransfer({
    senderPartyId: SOURCE_PARTY_ID,
    recipientPartyId: DESTINATION_PARTY_ID,
    amount: TRANSFER_AMOUNT,
  });
  console.log(`  preparedTransaction length: ${preparedTransaction.length} chars (base64)`);
  console.log(`  preparedTransactionHash:    ${preparedTransactionHash}`);
  console.log('');

  // 3. Submit to IV CWP makeTransaction with the base64 RawTransaction
  console.log('Step 3: Submitting makeTransaction to IV...');
  const operationId = await submitMakeTransaction({
    source,
    destinationAddress: DESTINATION_PARTY_ID,
    amount: TRANSFER_AMOUNT,
    rawTransaction: preparedTransaction,
    txHash: preparedTransactionHash,
  });
  console.log(`  OperationID: ${operationId}`);
  console.log('');

  // 4. Poll for completion
  console.log('Step 4: Waiting for MPC signing...');
  const result = await waitForOperation(operationId);
  if (!result) {
    throw new Error('Operation did not complete successfully');
  }

  console.log('');
  console.log('Done.');
  if (result.signedTransaction) {
    console.log(`  Signature (base64): ${result.signedTransaction}`);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    if (typeof process !== 'undefined') process.exit(1);
  });
}

export { main };
