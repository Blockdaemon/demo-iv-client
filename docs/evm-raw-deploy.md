# EVM Contract Deploy (Sign-Only)

Deploy an EVM contract via CWP `makeTransaction` with `RawTransaction`. Vault performs MPC signing only - the client broadcasts the signed transaction via a local RPC node.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |
| `IV_SOURCE_ADDRESS` | Vault-managed EVM address (deployer) |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IV_CAIP19` | `eip155:11155111/slip44:60` | CAIP-19 chain identifier (Sepolia) |
| `IV_EXPLORER_TX_URL` | `https://sepolia.etherscan.io/tx/` | Block explorer base URL |
| `EVM_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | EVM JSON-RPC endpoint for broadcasting |
| `IV_INITIATOR_ID` | (none) | Vault user email for initiator tracking |

## How it works

1. Build an unsigned EIP-1559 deploy transaction using `viem` (nonce, gas, fees from RPC)
2. Submit `RawTransaction` to CWP `makeTransaction` - Vault signs without broadcasting
3. Retrieve `Result.Transaction.SignedTransaction` from operation status
4. Broadcast signed bytes via `eth_sendRawTransaction` on your RPC node

## Policy posture

Requires a policy that allows `makeTransaction` from the source address. Deploy transactions have an empty destination address.

## Run

```bash
npm run evm:deploy
```

## Success criteria

- Operation reaches `SUCCEEDED` with `Result.Transaction.SignedTransaction` present
- Local `sendRawTransaction` succeeds and returns a transaction hash
