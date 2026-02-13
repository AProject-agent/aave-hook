# Borrow Hook - Documentation

## Overview

The Borrow Hook is an extension to Aave V3's `Pool` contract that introduces a pre-borrow validation layer. It allows the pool admin to set an external hook contract that is called before every borrow operation, enabling custom access control logic such as whitelist-based borrowing restrictions.

## Changed Files

### Core Protocol Changes

| File                                              | Change                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `contracts/protocol/pool/PoolStorage.sol`         | Added `address internal _borrowHook` storage slot                           |
| `contracts/protocol/pool/Pool.sol`                | Added hook check in `borrow()`, `setBorrowHook()`, `getBorrowHook()`        |
| `contracts/interfaces/IPool.sol`                  | Added `BorrowHookSet` event, `setBorrowHook()`, `getBorrowHook()` interface |
| `contracts/interfaces/IPoolConfigurator.sol`      | Added `setBorrowHook()` interface                                           |
| `contracts/protocol/pool/PoolConfigurator.sol`    | Added `setBorrowHook()` with `onlyPoolAdmin` guard                          |
| `contracts/protocol/libraries/helpers/Errors.sol` | Added error code `92` (`BORROW_HOOK_REJECTED`)                              |

### New Files

| File                                     | Description                                                  |
| ---------------------------------------- | ------------------------------------------------------------ |
| `contracts/interfaces/IBorrowHook.sol`   | Interface for borrow hook contracts                          |
| `contracts/mocks/helpers/BorrowHook.sol` | Reference implementation with whitelist + EIP-712 signatures |

## Detailed Changes

### 1. IBorrowHook Interface

```solidity
interface IBorrowHook {
  function beforeBorrow(
    address user, // msg.sender initiating the borrow
    address onBehalfOf, // address that will receive the debt
    address asset, // asset being borrowed
    uint256 amount, // amount being borrowed
    uint256 interestRateMode // 1 = stable, 2 = variable
  ) external returns (bool);
}
```

The hook receives the full borrow context. It must return `true` to allow the borrow or `false` to reject it.

### 2. Pool.sol - Borrow Hook Check

The hook is invoked at the top of `Pool.borrow()`, before `BorrowLogic.executeBorrow()`:

```solidity
function borrow(
  address asset,
  uint256 amount,
  uint256 interestRateMode,
  uint16 referralCode,
  address onBehalfOf
) public virtual override {
  if (_borrowHook != address(0)) {
    require(
      IBorrowHook(_borrowHook).beforeBorrow(
        msg.sender,
        onBehalfOf,
        asset,
        amount,
        interestRateMode
      ),
      Errors.BORROW_HOOK_REJECTED // '92'
    );
  }
  // ... existing BorrowLogic.executeBorrow() unchanged
}
```

### 3. Pool.sol - Setter/Getter

```solidity
function setBorrowHook(address hook) external virtual override onlyPoolConfigurator {
  _borrowHook = hook;
  emit BorrowHookSet(hook);
}

function getBorrowHook() external view virtual override returns (address) {
  return _borrowHook;
}
```

- `setBorrowHook` is guarded by `onlyPoolConfigurator`
- Setting to `address(0)` disables the hook

### 4. PoolConfigurator.sol - Admin Exposure

```solidity
function setBorrowHook(address hook) external override onlyPoolAdmin {
  _pool.setBorrowHook(hook);
}
```

Only the pool admin (via ACLManager) can set or change the borrow hook.

## Reference Implementation: BorrowHook.sol

The current `contracts/mocks/helpers/BorrowHook.sol` is a **mock/placeholder** used for testing only. Its logic is not finalized and should not be used as a basis for audit. The production hook implementation will conform to the `IBorrowHook` interface.

## Running Tests

```bash
# In one terminal
docker-compose up

# Open another tab or terminal
docker-compose exec contracts-env bash

# Run only the borrow hook tests
npm run test-borrow-hook

# Or run the full test suite
npm run test
```

## Added Integration Test

Integration tests in `test-suites/borrow-hook.spec.ts`:

| Test Case        | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| No hook set      | Borrow succeeds normally when `_borrowHook == address(0)`               |
| Not whitelisted  | Borrow reverts with `BORROW_HOOK_REJECTED` when user is not whitelisted |
| Whitelisted      | Borrow succeeds when user is whitelisted                                |
| onBehalfOf check | Credit delegation borrow checks the debt recipient, not the executor    |
| Hook removal     | Setting hook to `address(0)` restores unrestricted borrowing            |
