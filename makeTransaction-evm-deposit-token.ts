import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  TransactionsService,
  OpenAPI,
  cwpStatus,
  type cwpMakeTransactionStartRequest,
  type cwpResult,
  type cwpTransaction,
} from './iv-sdk-typescript';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { compileDepositToken } from './lib/compileDepositToken';
import { env, requireEnv } from './lib/env';
import { waitForOperation } from './lib/waitForOperation';

const TOKEN_DECIMALS = 18;

type AdminFunction =
  | 'allowUser'
  | 'disallowUser'
  | 'mint'
  | 'setFrozenTokens'
  | 'forcedTransfer'
  | 'pause'
  | 'unpause';

interface AdminContext {
  abi: Abi;
  caip19: string;
  client: PublicClient;
  contractAddress: Address;
  initiatorId?: string;
  ownerAddress: Address;
}

function createEvmClient(): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(env('EVM_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com')),
  });
}

function requireAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be a valid EVM address`);
  }
  return value;
}

function parseTokenAmount(value: string): bigint {
  try {
    const amount = parseUnits(value, TOKEN_DECIMALS);
    if (amount < 0n) {
      throw new Error('negative amount');
    }
    return amount;
  } catch {
    throw new Error(`Amount must be a non-negative decimal value with at most ${TOKEN_DECIMALS} decimal places`);
  }
}

function formatContractError(error: unknown): string {
  if (!(error instanceof BaseError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const reverted = error.walk(
    (candidate) => candidate instanceof ContractFunctionRevertedError,
  ) as ContractFunctionRevertedError | null;
  if (reverted?.data) {
    const args = reverted.data.args?.map(String).join(', ');
    return `${reverted.data.errorName}${args ? `(${args})` : ''}`;
  }

  return error.shortMessage;
}

async function canReceive(context: AdminContext, account: Address): Promise<boolean> {
  const result = await context.client.readContract({
    address: context.contractAddress,
    abi: context.abi,
    functionName: 'canReceive',
    args: [account],
  });
  return result as boolean;
}

async function getFrozenTokens(context: AdminContext, account: Address): Promise<bigint> {
  const result = await context.client.readContract({
    address: context.contractAddress,
    abi: context.abi,
    functionName: 'getFrozenTokens',
    args: [account],
  });
  return result as bigint;
}

function printFrozen(account: Address, amount: bigint): void {
  console.log(`Frozen for ${account}: ${formatUnits(amount, TOKEN_DECIMALS)} NBDT (${amount} base units)`);
}

async function waitForReceipt(context: AdminContext, transaction: cwpTransaction | undefined): Promise<void> {
  const transactionId = transaction?.ID;
  if (!transactionId?.startsWith('0x')) {
    console.log('Vault operation succeeded; no EVM transaction hash was returned for receipt polling.');
    return;
  }

  console.log(`Waiting for EVM receipt: ${transactionId}`);
  await context.client.waitForTransactionReceipt({ hash: transactionId as Hex });
}

async function submitAdminCall(
  context: AdminContext,
  functionName: AdminFunction,
  args: readonly unknown[] = [],
): Promise<void> {
  try {
    await context.client.simulateContract({
      account: context.ownerAddress,
      address: context.contractAddress,
      abi: context.abi,
      functionName,
      args,
    });
  } catch (error) {
    throw new Error(`Preflight failed: ${formatContractError(error)}`);
  }

  const calldata = encodeFunctionData({
    abi: context.abi,
    functionName,
    args,
  });
  const request: cwpMakeTransactionStartRequest = {
    CAIP19: context.caip19,
    Source: { Address: context.ownerAddress },
    Destination: [{ Address: context.contractAddress, Amount: '0' }],
    EVM: { Data: calldata },
    ...(context.initiatorId ? { InitiatorID: context.initiatorId } : {}),
  };

  console.log(`Submitting ${functionName} through CWP makeTransaction...`);
  const { OperationID } = await TransactionsService.cwpstartMakeTransaction(request);
  console.log(`OperationID: ${OperationID}`);

  const operation = await waitForOperation(OperationID);
  if (operation.Status === cwpStatus.FAILED) {
    throw new Error(`Vault operation failed: ${JSON.stringify(operation.ErrorDetails)}`);
  }

  const result: cwpResult | undefined = operation.Result;
  const transaction: cwpTransaction | undefined = result?.Transaction;
  await waitForReceipt(context, transaction);
  console.log(`${functionName} succeeded.\n`);
}

async function promptAddress(
  prompt: (question: string) => Promise<string>,
  label: string,
): Promise<Address> {
  return requireAddress((await prompt(`${label}: `)).trim(), label);
}

async function promptAmount(prompt: (question: string) => Promise<string>): Promise<bigint> {
  return parseTokenAmount((await prompt('Amount (NBDT): ')).trim());
}

function printMenu(): void {
  console.log(`
Deposit Token admin menu
  1. Check canReceive
  2. Add address to allow-list
  3. Remove address from allow-list
  4. Mint to an address
  5. Get frozen tokens
  6. Set frozen tokens
  7. Forced transfer
  8. Pause contract
  9. Unpause contract
  0. Quit`);
}

export async function main(): Promise<void> {
  OpenAPI.BASE = requireEnv('IV_API_BASE_URL');
  OpenAPI.TOKEN = requireEnv('IV_API_KEY');

  const { abi } = compileDepositToken();
  const context: AdminContext = {
    abi,
    caip19: env('IV_CAIP19', 'eip155:11155111/slip44:60'),
    client: createEvmClient(),
    contractAddress: requireAddress(requireEnv('IV_TOKEN_CONTRACT_ADDRESS'), 'IV_TOKEN_CONTRACT_ADDRESS'),
    initiatorId: process.env.IV_INITIATOR_ID || undefined,
    ownerAddress: requireAddress(requireEnv('IV_SOURCE_ADDRESS'), 'IV_SOURCE_ADDRESS'),
  };
  const readline = createInterface({ input, output });
  const prompt = (question: string) => readline.question(question);

  console.log('ERC-7943 NewBankDepositToken administration');
  console.log(`  Contract: ${context.contractAddress}`);
  console.log(`  Owner:    ${context.ownerAddress}`);

  try {
    let running = true;
    while (running) {
      printMenu();
      const choice = (await prompt('Select an option: ')).trim();

      try {
        if (choice === '0') {
          running = false;
        } else if (choice === '1') {
          const account = await promptAddress(prompt, 'Address to check');
          console.log(`canReceive(${account}): ${await canReceive(context, account)}`);
        } else if (choice === '2') {
          const account = await promptAddress(prompt, 'Address to add to the allow-list');
          await submitAdminCall(context, 'allowUser', [account]);
          console.log(`canReceive(${account}): ${await canReceive(context, account)}`);
        } else if (choice === '3') {
          const account = await promptAddress(prompt, 'Address to remove from the allow-list');
          await submitAdminCall(context, 'disallowUser', [account]);
          console.log(`canReceive(${account}): ${await canReceive(context, account)}`);
        } else if (choice === '4') {
          const account = await promptAddress(prompt, 'Mint recipient');
          if (!(await canReceive(context, account))) {
            throw new Error(`Recipient ${account} cannot receive tokens. Run option 2 to add it to the allow-list first.`);
          }
          await submitAdminCall(context, 'mint', [account, await promptAmount(prompt)]);
        } else if (choice === '5') {
          const account = await promptAddress(prompt, 'Address to inspect');
          printFrozen(account, await getFrozenTokens(context, account));
        } else if (choice === '6') {
          const account = await promptAddress(prompt, 'Address to freeze');
          await submitAdminCall(context, 'setFrozenTokens', [account, await promptAmount(prompt)]);
          printFrozen(account, await getFrozenTokens(context, account));
        } else if (choice === '7') {
          const from = await promptAddress(prompt, 'Source address');
          const to = await promptAddress(prompt, 'Recipient address');
          if (!(await canReceive(context, to))) {
            throw new Error(`Recipient ${to} cannot receive tokens. Run option 2 to add it to the allow-list first.`);
          }
          await submitAdminCall(context, 'forcedTransfer', [from, to, await promptAmount(prompt)]);
          printFrozen(from, await getFrozenTokens(context, from));
        } else if (choice === '8') {
          await submitAdminCall(context, 'pause');
        } else if (choice === '9') {
          await submitAdminCall(context, 'unpause');
        } else {
          console.log('Unknown option. Enter a number from 0 to 9.');
        }
      } catch (error) {
        console.error(`Action failed: ${formatContractError(error)}\n`);
      }
    }
  } finally {
    readline.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal:', formatContractError(error));
    process.exit(1);
  });
}
