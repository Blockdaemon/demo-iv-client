/**
 * Register a customer EVM chain via CWP `registerCustomChain`.
 *
 * Use the printed CAIP-19 / CAIP-2 values in later scripts (create-account,
 * get-address, makeTransaction examples).
 *
 * Required env: IV_API_BASE_URL, IV_API_KEY
 * Optional: IV_CHAIN_NAME, IV_CAIP19, IV_NATIVE_ASSET_SYMBOL,
 * IV_NATIVE_ASSET_DECIMALS, IV_TEST_NET, IV_INITIATOR_ID
 */

import {
  AssetsService,
  OpenAPI,
  cwpStatus,
  type cwpRegisterCustomChainStartRequest,
} from './iv-sdk-typescript';
import { env, requireEnv } from './lib/env';
import { waitForOperation } from './lib/waitForOperation';

function caip2FromCaip19(caip19: string): string {
  const i = caip19.indexOf('/');
  if (i < 0) throw new Error(`Invalid CAIP-19 (missing '/'): ${caip19}`);
  return caip19.slice(0, i);
}

export async function main() {
  OpenAPI.BASE = requireEnv('IV_API_BASE_URL');
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');

  const chainName = env('IV_CHAIN_NAME', 'custom/testnet');
  const caip19 = env('IV_CAIP19', 'eip155:1337/slip44:60');
  const nativeSymbol = env('IV_NATIVE_ASSET_SYMBOL', 'ETH');
  const nativeDecimals = Number(env('IV_NATIVE_ASSET_DECIMALS', '18'));
  const testNet = env('IV_TEST_NET', 'true').toLowerCase() !== 'false';
  const initiatorId = process.env.IV_INITIATOR_ID || undefined;
  const caip2 = caip2FromCaip19(caip19);

  console.log('Register custom chain via CWP registerCustomChain');
  console.log(`  ChainName:            ${chainName}`);
  console.log(`  CAIP-19:              ${caip19}`);
  console.log(`  CAIP-2 (derived):     ${caip2}`);
  console.log(`  NativeAssetSymbol:    ${nativeSymbol}`);
  console.log(`  NativeAssetDecimals:  ${nativeDecimals}`);
  console.log(`  TestNet:              ${testNet}\n`);

  const request: cwpRegisterCustomChainStartRequest = {
    ChainName: chainName,
    CAIP19: caip19,
    NativeAssetSymbol: nativeSymbol,
    NativeAssetDecimals: nativeDecimals,
    TestNet: testNet,
    ...(initiatorId ? { InitiatorID: initiatorId } : {}),
  };
  console.log('Request body:', JSON.stringify(request, null, 2));

  const { OperationID } = await AssetsService.cwpstartRegisterCustomChain(request);
  console.log(`OperationID: ${OperationID}\n`);

  const op = await waitForOperation(OperationID);
  if (op.Status === cwpStatus.FAILED) {
    console.error('Operation failed:', op.ErrorDetails);
    process.exit(1);
  }

  const chains = await AssetsService.cwplistChains();
  const registered = chains.find((c) => c.CAIP2 === caip2);
  console.log('Registered chain row:', JSON.stringify(registered ?? chains, null, 2));

  console.log('\nSet these for later scripts:');
  console.log(`  IV_CAIP19=${caip19}`);
  console.log(`  IV_CAIP2=${caip2}`);
  console.log(`  IV_CHAIN_NAME=${chainName}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
