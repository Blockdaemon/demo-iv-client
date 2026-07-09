# Institutional Vault Client SDKs

Client SDKs generated from Institutional Vault OpenAPI specs, plus TypeScript examples.

## Generating SDKs

```bash
# Full wallet / CWP join
npx openapi-typescript-codegen -i openapi.yaml -o iv-sdk-typescript

# Vault Canton Signing API (/api/cwp/canton)
npm run generate:canton-signing-sdk

# Java
openapi-generator generate -i openapi.yaml -g java -o ./iv-sdk-java

# Go
mkdir -p ./iv-sdk-go
oapi-codegen -package client -generate types,client -o ./iv-sdk-go/iv-client.gen.go openapi.yaml
```

## Examples

- [Create a Canton external party](canton-create-externalparty.md)
