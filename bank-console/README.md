# Bank payments console

This page is the bank. Vault, the automated approver, and policies stay in their own windows.

## Run

From `demo-iv-client`:

```bash
node bank-console/serve.mjs
```

Open http://127.0.0.1:8787.

The local server reads `bank-console/.env` on each request and adds the bearer token. The key is not in the page. `.env` is gitignored. Copy `.env.example` if you need a fresh file. On startup, when `IV_API_KEY` is set, the server adds ETH to `collections`, `gas-sponsor`, and `payout-hot` if it is missing, registers Sepolia USDC if it is not already a supported asset, then adds USDC to `collections` and `payout-hot` if it is missing. A 409 is treated as already done.

```
IV_API_KEY=
IV_API_HOST=payments-demo.api.dev.blockdaemon-wallet.com
IV_TENANT_ID=default
IV_INITIATOR_ID=
```

`IV_TENANT_ID` is sent as `x-tenant-id`. System API keys need it. The tenant is `default` even when the host label is `payments-demo`. `IV_INITIATOR_ID` is the Vault user email sent as `InitiatorID` on start operations. The page reads it from `/console-config`. The server reloads `.env` on each request.

## Asset

Ethereum Sepolia USDC. `serve.mjs` registers this token on startup when it is not already a supported asset:

| Field | Value |
| --- | --- |
| Symbol | USDC |
| Decimals | 6 |
| Chain | Ethereum Sepolia, `eip155:11155111` |
| Contract | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| CAIP-19 | `eip155:11155111/erc20:0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

Native ETH on that chain is `eip155:11155111/slip44:60`. Deposit addresses are allocated against that native id. The same EVM address receives USDC.

On startup the server enables USDC on `collections` and `payout-hot`, and ETH on those two accounts plus `gas-sponsor`. `gas-sponsor` holds ETH only and pays sweep gas.

## Accounts

One master key, `Default`.

| Account | Index | Role |
| --- | --- | --- |
| collections | 0 | Central wallet. Sweep destination. Not given to payers. |
| collections | 1 | Corporate Client A deposit. No ETH on this address. |
| collections | 2 | Corporate Client B deposit. |
| gas-sponsor | 0 | Holds ETH and pays the sponsored sweep. |
| payout-hot | 0 | USDC float for pay-out. |

Sepolia sweep contracts: Gateway `0x725DCbD76c4478618E1f57322bcE6dEdf8cE2bf9`, Consolidation `0x99BB491DB93c8eEAa671D9261fE0e79220E21a00`.

## What the page does

Deposits are read from transaction history (`GET /api/transactions`), not from the events socket. Sweep stays locked until a deposit is observed. The log then shows an example mainnet 200, and under it the `POST /api/compliance/screen/deposit` body for this transfer. The page does not call that route on Sepolia. The example is not the result of the testnet deposit.

Sweep is `POST /api/cwp/operations/start/generateConsolidationData` for USDC, then `POST /api/cwp/operations/start/sponsor` from `gas-sponsor`. The sponsor asset is native ETH (`eip155:11155111/slip44:60`). The USDC transfer stays inside the consolidation calldata. A sponsor whose CAIP-19 is the ERC-20 is validated as a call to that token contract, and the Gateway destination is rejected. The events socket sends `operation_status_update` as a hint. The page then reads `GET /api/cwp/operations/id/{id}/status`. A settled sweep prints the demand-account credit the bank core would consume. No issuer API is called.

## Presenter

Pay-in:

1. Press **Create deposit addresses**. Corporate Client A and Corporate Client B appear on the right.
2. The ecommerce customer sends a small Sepolia USDC amount to the Corporate Client A deposit address. The customer wallet pays its own ETH.
3. The log shows an example mainnet 200 labeled as not this deposit, then `POST /api/compliance/screen/deposit` for the observed transfer. Sweep unlocks because the deposit was observed.
4. Press **Sweep Corporate Client A**. It starts `generateConsolidationData` for collections index 1, then `sponsor` from `gas-sponsor`. The token lands on collections index 0. These two operation types do not need the automated approver.
5. Stay on this page for the fiat credit. Do not open Circle.

Pay-out, in the other windows:

1. Press **Show payout-hot balance**. The log shows `GET /api/vaults/{id}`. In production, treasury keeps that hot float inside an operating band.
2. Enter the Corporate Client Worker A address and press **Update payout-hot allow-list**. That adds the address to the payout-hot Block `ExternalDestination Except` list, creating the Block when none exists. An approver confirms the policy change.
3. Press **Pay Corporate Client Worker A**. That is `makeTransaction` of 1 USDC from `payout-hot` to the allow-listed address. One automated-approver confirmation, then Operations, Transaction History, and the block explorer.
4. Press **Pay random unapproved address**. The destination is the fictitious address `0x00000000000000000000000000000000deadbeef`. The payout fails with M0025. Operations shows the blocked payout. Policies shows the Block on `payout-hot`.
