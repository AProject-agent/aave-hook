// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

interface IBorrowHook {
  /**
   * @notice Called before a borrow operation is executed.
   * @param user The address initiating the borrow
   * @param onBehalfOf The address that will receive the debt
   * @param asset The address of the asset being borrowed
   * @param amount The amount being borrowed
   * @param interestRateMode The interest rate mode (1 = stable, 2 = variable)
   * @return True if the borrow is allowed, reverts otherwise
   */
  function beforeBorrow(
    address user,
    address onBehalfOf,
    address asset,
    uint256 amount,
    uint256 interestRateMode
  ) external returns (bool);
}
