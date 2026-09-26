# ERC-7943 Deposit Token Administration

Operate the deployed `NewBankDepositToken` through an interactive CWP menu. State-changing actions use CWP `makeTransaction`; eligibility and frozen-balance checks use read-only EVM RPC calls.

The contract combines the OpenZeppelin Stablecoin wizard baseline with the [`ERC20uRWA` extension](https://docs.openzeppelin.com/community-contracts/api/token).

## Required environment variables

| Variable | Description |
|----------|-------------|
| `IV_API_BASE_URL` | Vault instance URL |
| `IV_API_KEY` | API User key or Bearer JWT |
| `IV_SOURCE_ADDRESS` | Vault-managed token-owner address |
| `IV_TOKEN_CONTRACT_ADDRESS` | Address printed by `npm run evm:deploy` |

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IV_CAIP19` | `eip155:11155111/slip44:60` | CAIP-19 chain identifier |
| `EVM_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | RPC endpoint for reads, preflight, and receipt polling |
| `IV_INITIATOR_ID` | (none) | Vault user email for initiator tracking |

## Run

```bash
npm run evm:deposit-token
```

The menu provides:

1. `canReceive(address)` - check whether an address is eligible to receive tokens.
2. `allowUser(address)` - add an address to the token allow-list.
3. `disallowUser(address)` - remove an address from the token allow-list.
4. `mint(address, amount)` - mint after verifying that the recipient can receive.
5. `getFrozenTokens(address)` - display the ERC-7943 frozen amount.
6. `setFrozenTokens(address, amount)` - set the frozen amount and read it back.
7. `forcedTransfer(from, to, amount)` - perform an enforcement transfer after checking recipient eligibility.
8. `pause()` - pause ordinary token updates.
9. `unpause()` - resume ordinary token updates.

Amounts are entered in human-readable NBDT units and converted using 18 decimals.

Each state-changing call is simulated from `IV_SOURCE_ADDRESS` before CWP starts an operation. Contract errors, including `ERC7943CannotReceive`, `ERC7943CannotTransfer`, `ERC7943InsufficientUnfrozenBalance`, and `OwnableUnauthorizedAccount`, are printed before any Vault approval workflow begins.

## ERC-7943 behavior

- `setFrozenTokens` can set an amount above the current balance. This withholds future balances until the frozen amount is reduced.
- `forcedTransfer` does not require holder allowance. It bypasses sender restrictions but still requires `canReceive(to)`.
- This workflow intentionally uses `forcedTransfer`, not ERC-20 `burnFrom`, for compliance enforcement.

## Governance and approvals

The example uses `Ownable` for simplicity, so one Vault account is the owner, minter, pauser, allow-list administrator, freezer, and enforcer.

Production Deposit Token and RWA contracts should use OpenZeppelin `AccessControl` Roles and separate CWP Vault accounts for each operational role. In particular:

```solidity
function _checkFreezer(address, uint256) internal view override onlyRole(FREEZER_ROLE) {}
function _checkEnforcer(address, address, uint256) internal view override onlyRole(ENFORCER_ROLE) {}
```

Use distinct Vault accounts for minter, pauser, allow-list administrator, freezer, and enforcer roles. Apply transaction restrictions and approval groups to each account so governance is enforced before the corresponding role signs a contract call.

## Suggested walkthrough

1. Allow-list a recipient.
2. Confirm `canReceive` returns `true`.
3. Mint tokens to the recipient.
4. Set and inspect a frozen amount.
5. Allow-list a second address.
6. Force-transfer part of the first address's balance to the second.
7. Pause and unpause the contract.
