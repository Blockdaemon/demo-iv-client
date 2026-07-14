# Institutional Vault - CWP Example Scripts

TypeScript examples demonstrating programmatic use of the Institutional Vault [Core Wallet Platform (CWP)](https://vault.docs.blockdaemon.com/docs/cwp-overview) API.

## Prerequisites

- **Node.js** >= 18
- An Institutional Vault instance with at least one account and registered chain
- A **system user API key** (on-prem) or **Bearer JWT** (cloud) with Admin or MarketOps role
- For Canton examples: participant JSON Ledger API access with OAuth client credentials

## Quick start

```bash
cp .env-example .env       # fill in your Vault URL + credentials
npm install                # install dependencies
npm run generate           # generate TypeScript SDKs from OpenAPI specs (required)
npm run evm:transfer       # run the ERC-20 transfer example
```

## Examples

| Script | Command | Description |
|--------|---------|-------------|
| [EVM ERC-20 transfer](makeTransaction-evm-data-transfer.ts) | `npm run evm:transfer` | Send ERC-20 tokens via `EVM.Data` calldata |
| [EVM ERC-20 mint](makeTransaction-evm-data-mint.ts) | `npm run evm:mint` | Mint ERC-20 tokens via `EVM.Data` calldata |
| [EVM contract deploy](makeTransaction-raw-deploycontract.ts) | `npm run evm:deploy` | Sign-only deploy; client broadcasts via RPC |
| [Canton CC transfer](makeTransaction-raw-canton-transfer.ts) | `npm run canton:transfer` | Prepare, sign, execute Canton Amulet transfer |
| [Canton create external party](canton-create-externalparty.ts) | `npm run canton:create-externalparty` | Create an Ed25519 external party on a Canton participant |

Each example has a companion doc in [`docs/`](docs/) describing required env vars, policy posture, and success criteria.

## OpenAPI specs

| File | Contents |
|------|----------|
| `openapi/openapi.yaml` | Joined wallet + CWP spec (all routes). Download the latest from your Vault at `https://<your-vault>/swagger.html` (served as `openapi.yaml`). |
| `openapi/canton-gateway-signing-interface.yaml` | Canton Signing API (`/api/cwp/canton`) |

These specs are pinned to a specific Vault release. To refresh, download from your running instance's `/swagger.html` endpoint or copy from a tagged IV release (`mothership/docs/openapi-public-docs.yaml`), then run `npm run generate` and `npm run typecheck` to verify compatibility.

## Advanced: other language SDKs

The OpenAPI specs work with any code generator. Examples for non-TypeScript:

```bash
# Java (requires openapi-generator CLI)
openapi-generator generate -i openapi/openapi.yaml -g java -o ./iv-sdk-java

# Go (requires oapi-codegen)
mkdir -p ./iv-sdk-go
oapi-codegen -package client -generate types,client -o ./iv-sdk-go/iv-client.gen.go openapi/openapi.yaml
```

## Links

- [Vault documentation](https://vault.docs.blockdaemon.com/)
- [CWP makeTransaction guide](https://vault.docs.blockdaemon.com/docs/cwp-make-transaction)
- [Generate client SDKs](https://vault.docs.blockdaemon.com/reference/generate-client-sdks)
- [CWP operations overview](https://vault.docs.blockdaemon.com/docs/cwp-operations)
