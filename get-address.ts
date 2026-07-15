/**
 * Derive an address for an existing account via CWP `POST /addresses/get`.
 *
 * Requires the chain to be registered and the account to exist. Prints
 * IV_SOURCE_ADDRESS for later makeTransaction examples.
 *
 * Required env: IV_API_BASE_URL, IV_API_KEY, IV_ACCOUNT_NAME
 * Optional: MASTER_KEY, IV_CAIP2 (or IV_CAIP19), IV_ADDRESS_INDEX
 */

import {
  AddressesService,
  OpenAPI,
  type cwpGetAddressCAIP2Request,
} from './iv-sdk-typescript';
import { env, requireEnv } from './lib/env';

function resolveCaip2(): string {
  const caip2 = process.env.IV_CAIP2;
  if (caip2) return caip2;

  const caip19 = process.env.IV_CAIP19;
  if (caip19) {
    const i = caip19.indexOf('/');
    if (i < 0) throw new Error(`Invalid IV_CAIP19 (missing '/'): ${caip19}`);
    return caip19.slice(0, i);
  }

  return env('IV_CAIP2', 'eip155:1337');
}

export async function main() {
  OpenAPI.BASE = requireEnv('IV_API_BASE_URL');
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');

  const masterKey = env('MASTER_KEY', 'Default');
  const account = requireEnv('IV_ACCOUNT_NAME');
  const caip2 = resolveCaip2();
  const index = Number(env('IV_ADDRESS_INDEX', '0'));

  console.log('Get address via CWP POST /addresses/get');
  console.log(`  MasterKey:  ${masterKey}`);
  console.log(`  Account:    ${account}`);
  console.log(`  CAIP-2:     ${caip2}`);
  console.log(`  Index:      ${index}\n`);

  const request: cwpGetAddressCAIP2Request = {
    MasterKey: masterKey,
    Account: account,
    CAIP2: caip2,
    Index: index,
  };
  console.log('Request body:', JSON.stringify(request, null, 2));

  const { Address } = await AddressesService.cwpgetAddressCaip2(request);
  console.log(`\nAddress: ${Address}`);

  console.log('\nSet these for later scripts:');
  console.log(`  MASTER_KEY=${masterKey}`);
  console.log(`  IV_ACCOUNT_NAME=${account}`);
  console.log(`  IV_CAIP2=${caip2}`);
  console.log(`  IV_SOURCE_ADDRESS=${Address}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
