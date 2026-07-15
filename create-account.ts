/**
 * Create a Vault account via CWP `createAccount`.
 *
 * Include IV_INITIATOR_ID (registered Vault user email) so the gateway can
 * sync the matching wallet account row. Print the account name for get-address
 * and later makeTransaction scripts.
 *
 * Required env: IV_API_BASE_URL, IV_API_KEY, IV_INITIATOR_ID, IV_ACCOUNT_NAME
 * Optional: MASTER_KEY (default Default)
 */

import {
  AccountsService,
  OpenAPI,
  cwpStatus,
  type cwpCreateAccountStartRequest,
} from './iv-sdk-typescript';
import { env, requireEnv } from './lib/env';
import { waitForOperation } from './lib/waitForOperation';

export async function main() {
  OpenAPI.BASE = requireEnv('IV_API_BASE_URL');
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');

  const masterKey = env('MASTER_KEY', 'Default');
  const accountName = requireEnv('IV_ACCOUNT_NAME');
  const initiatorId = requireEnv('IV_INITIATOR_ID');

  console.log('Create account via CWP createAccount');
  console.log(`  MasterKey:    ${masterKey}`);
  console.log(`  Name:         ${accountName}`);
  console.log(`  InitiatorID:  ${initiatorId}\n`);

  const request: cwpCreateAccountStartRequest = {
    MasterKey: masterKey,
    Name: accountName,
    InitiatorID: initiatorId,
  };
  console.log('Request body:', JSON.stringify(request, null, 2));

  const { OperationID } = await AccountsService.cwpstartCreateAccount(request);
  console.log(`OperationID: ${OperationID}\n`);

  const op = await waitForOperation(OperationID);
  if (op.Status === cwpStatus.FAILED) {
    console.error('Operation failed:', op.ErrorDetails);
    process.exit(1);
  }

  console.log('Account created (operation SUCCEEDED).');
  console.log('\nSet these for later scripts:');
  console.log(`  MASTER_KEY=${masterKey}`);
  console.log(`  IV_ACCOUNT_NAME=${accountName}`);
  console.log('  # then: npm run cwp:get-address');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
