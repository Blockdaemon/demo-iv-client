# EVM ERC-20 Mint

Mint ERC-20 tokens via CWP `makeTransaction` with structured `EVM.Data`.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |
| `IV_SOURCE_ADDRESS` | Vault-managed EVM address (must be token owner/minter) |
| `IV_TOKEN_CONTRACT_ADDRESS` | ERC-20 token contract with `mint(address,uint256)` |
| `IV_RECEIVER_ADDRESS` | Address to receive minted tokens |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IV_CAIP19` | `eip155:11155111/slip44:60` | CAIP-19 chain identifier (Sepolia) |
| `IV_EXPLORER_TX_URL` | `https://sepolia.etherscan.io/tx/` | Block explorer base URL |
| `IV_MINT_AMOUNT_WEI` | `40000000000000000000` | Mint amount in token smallest units |
| `IV_INITIATOR_ID` | (none) | Vault user email for initiator tracking |

## Policy posture

Requires a policy that allows `makeTransaction` from the source address. The source must be the token contract owner or have minter role.

## Run

```bash
npm run evm:mint
```

## Success criteria

- Operation reaches `SUCCEEDED` status
- `Result.Transaction.ID` contains the on-chain transaction hash
