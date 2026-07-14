# Canton CC Raw Transfer

Transfer Canton CC (Amulet) using the Canton wallet SDK to prepare the transaction, Vault for MPC signing, and the SDK to execute on the ledger.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |
| `CANTON_SOURCE_ADDRESS` | Sender partyId (e.g. `hint::1220...`) |
| `CANTON_DESTINATION_ADDRESS` | Recipient partyId |
| `CANTON_AUTH_ISSUER` | Keycloak/OIDC issuer URL for Canton participant |
| `CANTON_AUTH_CLIENT_ID` | OAuth client ID |
| `CANTON_AUTH_CLIENT_SECRET` | OAuth client secret |
| `LEDGER_CLIENT_URL` | Participant JSON Ledger API base URL |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IV_CAIP19` | `canton:devnet/slip44:6767` | CAIP-19 identifier |
| `CANTON_TRANSFER_AMOUNT` | `1` | Amount of CC to transfer |
| `VALIDATOR_URL` | (none) | Validator API URL |
| `SCAN_PROXY_URL` | (none) | Scan proxy URL for registry |
| `IV_INITIATOR_ID` | (none) | Vault user email for initiator tracking |

## How it works

1. **Prepare** - Canton wallet SDK builds a `TransferFactory_Transfer` command and calls `/v2/interactive-submission/prepare` on the JSON Ledger API
2. **Sign** - Submit `RawTransaction` (base64 preparedTransaction) + `TxHash` (preparedTransactionHash) to CWP `makeTransaction` for MPC signing
3. **Wait** - Poll operation status (or WebSocket wake) until `SUCCEEDED`
4. **Execute** - Use `Result.Transaction.SignedTransaction` with the SDK `ledger.execute()` to commit on-ledger

## Policy posture

Requires a policy that allows `makeTransaction` for the Canton CAIP-19 chain from the source address.

## Run

```bash
npm run canton:transfer
```

## Success criteria

- Operation `SUCCEEDED` with Ed25519 `SignedTransaction` present
- `sdk.ledger.execute()` returns a ledger completion (updateId + offset)
