# Get Address

Derive a blockchain address for an existing account via CWP `POST /api/cwp/addresses/get`.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |
| `IV_ACCOUNT_NAME` | Account created earlier (e.g. via `cwp:create-account`) |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MASTER_KEY` | `Default` | Master key that owns the account |
| `IV_CAIP2` | from `IV_CAIP19`, else `eip155:1337` | Chain CAIP-2 (chain must already be registered) |
| `IV_CAIP19` | (none) | If set and `IV_CAIP2` is unset, CAIP-2 is the segment before `/` |
| `IV_ADDRESS_INDEX` | `0` | Derivation index (main address) |

## Prerequisites

1. Chain registered (`npm run cwp:register-chain` or bootstrap / known-chain registration)
2. Account created (`npm run cwp:create-account`)

## Run

```bash
npm run cwp:get-address
```

## Success criteria

- Response includes `Address`
- Stdout prints `IV_SOURCE_ADDRESS` for EVM `makeTransaction` examples

## Next

Copy `IV_SOURCE_ADDRESS` into `.env`, then run transfer/mint/deploy examples:

```bash
npm run evm:transfer
```
