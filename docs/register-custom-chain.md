# Register Custom Chain

Register a customer EVM chain and its native asset via CWP `POST /api/cwp/operations/start/registerCustomChain`.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IV_CHAIN_NAME` | `custom/testnet` | Slash-formatted `protocol/network` name (required shape for non-builtin chains) |
| `IV_CAIP19` | `eip155:1337/slip44:60` | Native asset CAIP-19; CAIP-2 is derived from it |
| `IV_NATIVE_ASSET_SYMBOL` | `ETH` | Native asset symbol |
| `IV_NATIVE_ASSET_DECIMALS` | `18` | Native asset decimals |
| `IV_TEST_NET` | `true` | Set `false` for mainnet-style registration |
| `IV_INITIATOR_ID` | (none) | Vault user email for initiator tracking |

## Policy posture

`registerCustomChain` is a config update. If Config Restrictions require approvers, complete confirmation/approval before the operation succeeds. The call is idempotent: re-registering the same CAIP-2 updates the stored chain.

## Run

```bash
npm run cwp:register-chain
```

## Success criteria

- Operation reaches `SUCCEEDED`
- `GET /api/cwp/chains/list` includes the new CAIP-2
- Stdout prints `IV_CAIP19` / `IV_CAIP2` for later scripts

## Next

```bash
npm run cwp:create-account
npm run cwp:get-address
```

Note: transaction build/broadcast for a custom chain also needs a matching `blockchains[]` native-driver entry in `wallet.yaml` and a wallet restart. This script only registers the chain in MPA.
