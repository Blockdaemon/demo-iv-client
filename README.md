# Institutional Vault - CWP Example Scripts

TypeScript examples demonstrating programmatic use of the Institutional Vault [Core Wallet Platform (CWP)](https://vault.docs.blockdaemon.com/reference/quick-start-blockdaemon-wallet) API.

## Prerequisites

- **Node.js** >= 18
- An Institutional Vault instance with **API User key** or **Bearer JWT**
- For Canton examples: participant JSON Ledger API access with OAuth client credentials

## Quick start

```bash
cp .env-example .env       # fill in your Vault URL + credentials
npm install                # install dependencies
npm run generate           # generate TypeScript SDKs from OpenAPI specs (required)
npm run evm:transfer       # run the ERC-20 transfer example
```

## Examples


| Script                                                         | Command                               | Description                                              |
| -------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| [Register custom chain](register-custom-chain.ts)              | `npm run cwp:register-chain`          | Register a customer EVM chain + native asset             |
| [Create account](create-account.ts)                            | `npm run cwp:create-account`          | Create a named account under a master key                |
| [Get address](get-address.ts)                                  | `npm run cwp:get-address`             | Derive an address for an account (feeds later scripts)   |
| [EVM ERC-20 transfer](makeTransaction-evm-data-transfer.ts)    | `npm run evm:transfer`                | Send ERC-20 tokens via `EVM.Data` calldata               |
| [EVM ERC-20 mint](makeTransaction-evm-data-mint.ts)            | `npm run evm:mint`                    | Mint ERC-20 tokens via `EVM.Data` calldata               |
| [EVM ERC-7943 deploy](makeTransaction-raw-deploycontract.ts)   | `npm run evm:deploy`                  | Compile and deploy an OpenZeppelin ERC-7943 token        |
| [EVM ERC-7943 admin](makeTransaction-evm-deposit-token.ts)     | `npm run evm:deposit-token`           | Allow-list, mint, freeze, force-transfer, and pause      |
| [Canton CC transfer](makeTransaction-raw-canton-transfer.ts)   | `npm run canton:transfer`             | Prepare, sign, execute Canton Amulet transfer            |
| [Canton create external party](canton-create-externalparty.ts) | `npm run canton:create-externalparty` | Create an Ed25519 external party on a Canton participant |


Setup order for a new custom chain: `cwp:register-chain` → `cwp:create-account` → `cwp:get-address` (then copy `IV_SOURCE_ADDRESS` into `.env` for EVM examples).

Each example has a companion doc in `[docs/](docs/)` describing required env vars, policy posture, and success criteria.

For the ERC-7943 walkthrough, run `evm:deploy`, copy the printed contract address to `IV_TOKEN_CONTRACT_ADDRESS`, then run `evm:deposit-token`. The contract starts from the [OpenZeppelin Stablecoin wizard](https://wizard.openzeppelin.com/#stablecoin) and adds the [ERC-7943 `ERC20uRWA` extension](https://docs.openzeppelin.com/community-contracts/api/token).

## OpenAPI specs


| File                                            | Contents                               |
| ----------------------------------------------- | -------------------------------------- |
| `openapi/openapi.yaml`                          | IV and CWP API spec                    |
| `openapi/canton-gateway-signing-interface.yaml` | Canton Signing API (`/api/cwp/canton`) |


These specs are pinned to a specific Vault release. To refresh, download from your running instance's `/swagger.html` endpoint, then run `npm run generate` and `npm run typecheck` to verify compatibility.

## Other language SDKs

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
- [CWP makeTransaction guide](https://vault.docs.blockdaemon.com/reference/cwpstartmaketransaction)
- [Generate client SDKs](https://vault.docs.blockdaemon.com/reference/generate-client-sdks)
- [CWP operations overview](https://vault.docs.blockdaemon.com/reference/cwpgetoperationstatus)

