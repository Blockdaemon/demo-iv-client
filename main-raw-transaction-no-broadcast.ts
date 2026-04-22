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
  http,
  parseEther,
  serializeTransaction,
  type Hex,
} from 'viem';
import { hoodi } from 'viem/chains';

declare const process: any;
declare const require: any;
declare const module: any;

const WITHDRAWAL_ADDRESS = '0x3f75fE68752f6A127e8D73a697D210148E4D75e8';
const RECEIVER_ADDRESS = '0xe04B031223A1D3c9AC5cfDfe3364b356d98970dC';
const WITHDRAW_AMOUNT = '0.00001';

const CONCURRENCY = 15;
const DURATION_MS = 120_000;

OpenAPI.BASE = (typeof process !== 'undefined' && process.env?.IV_API_BASE_URL) || 'https://americas-sales-team-1.api.blockdaemon-wallet.com';
OpenAPI.TOKEN = (typeof process !== 'undefined' && process.env?.WALLET_API_KEY);

let cachedUnsignedHex: Hex | null = null;

async function buildUnsignedEthTransferHex(params: {
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountEth: string;
}): Promise<Hex> {
  if (cachedUnsignedHex) return cachedUnsignedHex;

  const client = createPublicClient({
    chain: hoodi,
    transport: http('https://ethereum-hoodi-rpc.publicnode.com'),
  });

  const nonce = await client.getTransactionCount({ address: params.fromAddress });
  const value = parseEther(params.amountEth);
  const gas = await client.estimateGas({ account: params.fromAddress, to: params.toAddress, value });
  const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas();

  const txEip1559 = {
    chainId: hoodi.id,
    nonce,
    to: params.toAddress,
    value,
    gas,
    maxFeePerGas: maxFeePerGas!,
    maxPriorityFeePerGas: maxPriorityFeePerGas!,
    accessList: [],
    type: 'eip1559' as const,
    data: '0x' as Hex,
  };

  cachedUnsignedHex = serializeTransaction(txEip1559);
  return cachedUnsignedHex;
}

async function signOnce(): Promise<{ ok: boolean; durationMs: number }> {
  const start = Date.now();
  try {
    const unsignedHex = await buildUnsignedEthTransferHex({
      fromAddress: WITHDRAWAL_ADDRESS as `0x${string}`,
      toAddress: RECEIVER_ADDRESS as `0x${string}`,
      amountEth: WITHDRAW_AMOUNT,
    });

    const requestBody: RawTransferPost = {
      protocol: Protocol.ETHEREUM,
      network: Network.HOODI,
      symbol: 'ETH',
      fromAddress: WITHDRAWAL_ADDRESS,
      rawTransaction: unsignedHex,
    };

    const response = await TransactionsService.createRawTransfer(requestBody) as any;
    const operationId = response?.asyncOperationID || response?.operationID || response?.id;
    if (!operationId) throw new Error('Missing operationID');

    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      const op = await OperationsService.getMpaOperationById(operationId as any) as any;
      const status = op.Status || op.status;

      if (status === 'fin') {
        return { ok: true, durationMs: Date.now() - start };
      }
      if (status === 'err' || status === 'rej' || status === 'can') {
        return { ok: false, durationMs: Date.now() - start };
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return { ok: false, durationMs: Date.now() - start };
  } catch {
    return { ok: false, durationMs: Date.now() - start };
  }
}

async function worker(
  workerId: number,
  deadline: number,
  results: { ok: number; fail: number; durations: number[] },
) {
  while (Date.now() < deadline) {
    const { ok, durationMs } = await signOnce();
    if (ok) {
      results.ok++;
      results.durations.push(durationMs);
    } else {
      results.fail++;
    }
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log('🔐 Signing performance test');
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Duration:    ${DURATION_MS / 1000}s`);
  console.log(`  From:        ${WITHDRAWAL_ADDRESS}`);
  console.log(`  To:          ${RECEIVER_ADDRESS}\n`);

  // Pre-build and cache the unsigned tx before spawning workers
  await buildUnsignedEthTransferHex({
    fromAddress: WITHDRAWAL_ADDRESS as `0x${string}`,
    toAddress: RECEIVER_ADDRESS as `0x${string}`,
    amountEth: WITHDRAW_AMOUNT,
  });
  console.log('✅ Unsigned tx cached. Starting workers...\n');

  const deadline = Date.now() + DURATION_MS;
  const results = { ok: 0, fail: 0, durations: [] as number[] };

  const workers = Array.from({ length: CONCURRENCY }, (_, i) =>
    worker(i, deadline, results),
  );
  await Promise.all(workers);

  const total = results.ok + results.fail;
  const sorted = results.durations.slice().sort((a, b) => a - b);
  const avgMs = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;

  console.log('\n═══════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════');
  console.log(`  Total requests:  ${total}`);
  console.log(`  Successful:      ${results.ok}`);
  console.log(`  Failed:          ${results.fail}`);
  console.log(`  Throughput:      ${(results.ok / (DURATION_MS / 1000)).toFixed(2)} signs/sec`);
  if (sorted.length) {
    console.log(`  Avg latency:     ${avgMs.toFixed(0)} ms`);
    console.log(`  p50 latency:     ${percentile(sorted, 50)} ms`);
    console.log(`  p95 latency:     ${percentile(sorted, 95)} ms`);
    console.log(`  p99 latency:     ${percentile(sorted, 99)} ms`);
    console.log(`  Min latency:     ${sorted[0]} ms`);
    console.log(`  Max latency:     ${sorted[sorted.length - 1]} ms`);
  }
  console.log('═══════════════════════════════════════\n');
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch(console.error);
}

export { main };
