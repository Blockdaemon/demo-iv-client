# EVM ERC-20 Transfer

Send ERC-20 tokens via CWP `makeTransaction` with structured `EVM.Data`.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |
| `IV_SOURCE_ADDRESS` | Vault-managed EVM address (sender) |
| `IV_TOKEN_CONTRACT_ADDRESS` | ERC-20 token contract |
| `IV_RECEIVER_ADDRESS` | Recipient address |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IV_CAIP19` | `eip155:11155111/slip44:60` | CAIP-19 chain identifier (Sepolia) |
| `IV_EXPLORER_TX_URL` | `https://sepolia.etherscan.io/tx/` | Block explorer base URL |
| `IV_TRANSFER_AMOUNT_WEI` | `35000000000000000000` | Transfer amount in token smallest units |
| `IV_INITIATOR_ID` | (none) | Vault user email for initiator tracking |

## Policy posture

Requires a policy that allows `makeTransaction` from the source address with the configured CAIP-19 chain. If confirmations are required, the initiator must confirm via ApproverApp or automated approver.

## Run

```bash
npm run evm:transfer
```

## Success criteria

- Operation reaches `SUCCEEDED` status
- `Result.Transaction.ID` contains the on-chain transaction hash
- Explorer link is printed to stdout
