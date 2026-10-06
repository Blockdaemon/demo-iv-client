# Bank payments console

This page is the bank. Vault, the automated approver, and policies stay in their own windows.

## Run

From `demo-iv-client`:

```bash
node bank-console/serve.mjs
```

Open http://127.0.0.1:8787.

The local server reads `bank-console/.env` on each request and adds the bearer token. The key is not in the page. `.env` is gitignored. Copy `.env.example` if you need a fresh file.

```
IV_API_KEY=
IV_API_HOST=payments-demo.api.dev.blockdaemon-wallet.com
IV_TENANT_ID=default
```

`IV_TENANT_ID` is sent as `x-tenant-id`. System API keys need it. The tenant is `default` even when the host label is `payments-demo`.

## Asset

Polygon Amoy USDC, already registered on the tenant:

| Field | Value |
| --- | --- |
| Symbol | USDC |
| Decimals | 6 |
| Chain | Polygon Amoy, `eip155:80002` |
| Contract | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |
| CAIP-19 | `eip155:80002/erc20:0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |

Native POL on that chain is `eip155:80002/slip44:966`. Deposit addresses are allocated against that native id. The same EVM address receives USDC.

USDC is enabled on `collections` and `payout-hot`. `gas-sponsor` holds POL only and pays sweep gas.

## Accounts

One master key, `Default`.

| Account | Index | Role |
| --- | --- | --- |
| collections | 0 | Central wallet. Sweep destination. Not given to payers. |
| collections | 1 | Corporate A deposit. No POL on this address. |
| collections | 2 | Corporate B deposit. |
| gas-sponsor | 0 | Holds POL and pays the sponsored sweep. |
| payout-hot | 0 | USDC float for pay-out. |

Amoy sweep contracts: Gateway `0x918C691F014B621721c6E3D24d160BBe02808b05`.

## What the page does

Deposits are read from transaction history (`GET /api/transactions`), not from the events socket. Screening is one call, `POST /api/compliance/screen/deposit`, with `address` set to the Corporate A deposit address and `isInternal` false. Sweep stays locked until that response returns, and stays locked when `alerts` is not empty. An Amoy or Sepolia hash is not in Chainalysis KYT, so the call returns 500 `no updates/alerts`. The page keeps Sweep locked and shows an example mainnet 200 beside that error. The example is not the result of the testnet deposit.

Sweep is `POST /api/cwp/operations/start/generateConsolidationData`, then `POST /api/cwp/operations/start/sponsor` from `gas-sponsor`. The events socket sends `operation_status_update` as a hint. The page then reads `GET /api/cwp/operations/id/{id}/status`. A settled sweep prints the demand-account credit the bank core would consume. No issuer API is called.

## Presenter

Pay-in:

1. Press **Create deposit addresses**. Corporate A and Corporate B appear on the right.
2. From MetaMask A, send a small Amoy USDC amount to the Corporate A address. MetaMask pays its own POL.
3. The page screens the deposit. On Amoy the Chainalysis call returns 500. The log shows that error, then an example mainnet 200 labeled as not this deposit. Sweep stays locked.
4. A mainnet transfer with an empty `alerts` array is what unlocks **Sweep Corporate A**. These two operation types do not need the automated approver.
5. Stay on this page for the fiat credit. Do not open Circle.

Pay-out, in the other windows:

1. Show the USDC balance on `payout-hot`.
2. Allowed payout to MetaMask B: one automated-approver confirmation, then Operations, Transaction History, and the block explorer.
3. A payout to any other address fails with M0025. Operations shows the blocked payout. Policies shows the Block on `payout-hot` and the one-approver rule beside it.
