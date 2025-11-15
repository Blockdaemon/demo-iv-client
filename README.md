# Institutional Vault Client SDKs

This repository contains client SDKs generated from the Institutional Wallet OpenAPI specification.

## Generating SDKs

When the OpenAPI specification is updated, regenerate the SDKs:

```bash
# TypeScript
npx openapi-typescript-codegen -i openapi.yaml -o iv-sdk-typescript

# Java
openapi-generator generate -i openapi.yaml -g java -o ./iv-sdk-java

# Go
mkdir -p ./iv-sdk-go
oapi-codegen -package client -generate types,client -o ./iv-sdk-go/iv-client.gen.go openapi.yaml
```

### Getting Help

- [OpenAPI Generator Documentation](https://openapi-generator.tech/)
- [oapi-codegen Documentation](https://github.com/oapi-codegen/oapi-codegen)
