# Create a Canton external party

`canton-create-externalparty.ts` creates a Canton external party using Vault for key management and signing, and the participant JSON Ledger API for topology generation and allocation.

## Flow

1. `createKey` / `getKeys` (Vault)
2. `generate-topology` (participant)
3. `signTransaction` (Vault)
4. `allocate` (participant)

```mermaid
sequenceDiagram
    participant Client as Wallet Client
    participant Vault as Vault<br/>/api/cwp/canton
    participant Ledger as Participant<br/>JSON Ledger API

    Client->>Vault: POST /getKeys
    alt key not found
        Client->>Vault: POST /createKey
        Vault-->>Client: publicKey, key id
    else key exists
        Vault-->>Client: publicKey, key id
    end

    Client->>Ledger: POST /v2/parties/external/generate-topology
    Ledger-->>Client: partyId, multiHash, topologyTransactions

    Client->>Vault: POST /signTransaction<br/>(txHash = multiHash)
    Vault-->>Client: txId (pending)
    loop until signed
        Client->>Vault: POST /getTransaction
        Vault-->>Client: status, signature
    end

    Client->>Ledger: POST /v2/parties/external/allocate<br/>(topology + multiHash signature)
    Ledger-->>Client: partyId
```

## Run

```bash
cp .env-example .env
npm install
npm run generate:canton-signing-sdk
npm run canton-create-externalparty
```
