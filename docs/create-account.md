# Create Account

Create a named account under an existing master key via CWP `POST /api/cwp/operations/start/createAccount`.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | System user API key or Bearer JWT |
| `IV_INITIATOR_ID` | Registered Vault user email (required so the gateway syncs a wallet account row) |
| `IV_ACCOUNT_NAME` | Account name (`^\w+( \w+)*$` - letters, digits, underscore; spaces between words OK) |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MASTER_KEY` | `Default` | Existing master key name |

## Policy posture

`createAccount` is uncategorized in MPA policy (no V2 transaction/config restriction quorum). The initiator still must be a valid registered user when confirmations are required elsewhere; set `InitiatorID` so Vault can backfill the account.

## Run

```bash
npm run cwp:create-account
```

## Success criteria

- Operation reaches `SUCCEEDED`
- Stdout prints `MASTER_KEY` and `IV_ACCOUNT_NAME` for `get-address` and later scripts

## Next

```bash
npm run cwp:get-address
```
