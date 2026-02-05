// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import {IBorrowHook} from '../../interfaces/IBorrowHook.sol';
import {AccessControl} from '../../dependencies/openzeppelin/contracts/AccessControl.sol';

contract BorrowHook is IBorrowHook, AccessControl {
  /// @notice Role for addresses that can sign whitelist authorizations
  bytes32 public constant SIGNER_ROLE = keccak256('SIGNER_ROLE');
  /// @notice Role for addresses that can directly whitelist borrowers
  bytes32 public constant WHITELISTER_ROLE = keccak256('WHITELISTER_ROLE');

  /// @notice Mapping of addresses that are whitelisted to borrow
  mapping(address => bool) private s_isWhitelisted;
  /// @notice Mapping of nonces for each account to prevent replay attacks
  mapping(address => uint256) private s_nonces;

  /// @notice Domain separator for EIP-712 signatures
  bytes32 public immutable DOMAIN_SEPARATOR;
  /// @notice Typehash for whitelist authorization
  bytes32 public constant WHITELIST_TYPEHASH =
    keccak256('WhitelistAuthorization(address account,uint256 nonce,uint256 deadline)');

  /// @notice Emitted when an address is added to the whitelist
  /// @param account The address that was whitelisted
  event AddressWhitelisted(address indexed account);
  /// @notice Emitted when an address is added to the whitelist via signature
  /// @param account The address that was whitelisted
  /// @param nonce The nonce used for the signature
  event AddressWhitelistedWithSignature(address indexed account, uint256 nonce);
  /// @notice Emitted when an address is removed from the whitelist
  /// @param account The address that was removed from whitelist
  event AddressRemovedFromWhitelist(address indexed account);
  /// @notice Emitted when borrow hook is called
  event BorrowHookCalled(
    address indexed user,
    address indexed onBehalfOf,
    address indexed asset,
    uint256 amount,
    uint256 interestRateMode
  );

  /// @notice Thrown when a non-whitelisted address attempts to borrow
  /// @param account Unauthorized borrower
  error NotWhitelisted(address account);
  /// @notice Thrown when the signature has expired
  error SignatureExpired();
  /// @notice Thrown when the signature is invalid
  error InvalidSignature();

  /// @param admin The initial admin address
  constructor(address admin) {
    _setupRole(DEFAULT_ADMIN_ROLE, admin);
    _setupRole(SIGNER_ROLE, admin);
    _setupRole(WHITELISTER_ROLE, admin);

    DOMAIN_SEPARATOR = keccak256(
      abi.encode(
        keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
        keccak256(bytes('BorrowHook')),
        keccak256(bytes('1')),
        block.chainid,
        address(this)
      )
    );
  }

  /// @inheritdoc IBorrowHook
  function beforeBorrow(
    address user,
    address onBehalfOf,
    address asset,
    uint256 amount,
    uint256 interestRateMode
  ) external override returns (bool) {
    emit BorrowHookCalled(user, onBehalfOf, asset, amount, interestRateMode);

    return s_isWhitelisted[onBehalfOf];
  }

  /// @notice Add address to whitelist using signer signature
  /// @param account Address to whitelist
  /// @param deadline Timestamp after which the signature is invalid
  /// @param v Signature v parameter
  /// @param r Signature r parameter
  /// @param s Signature s parameter
  function addToWhitelistWithSignature(
    address account,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external {
    if (block.timestamp > deadline) {
      revert SignatureExpired();
    }

    uint256 nonce = s_nonces[account];

    bytes32 structHash = keccak256(abi.encode(WHITELIST_TYPEHASH, account, nonce, deadline));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', DOMAIN_SEPARATOR, structHash));
    address signer = ecrecover(digest, v, r, s);

    if (signer == address(0) || !hasRole(SIGNER_ROLE, signer)) {
      revert InvalidSignature();
    }

    s_nonces[account] = nonce + 1;
    s_isWhitelisted[account] = true;

    emit AddressWhitelistedWithSignature(account, nonce);
  }

  /// @notice Add address to whitelist
  /// @param account Address to whitelist
  function addToWhitelist(address account) external onlyRole(WHITELISTER_ROLE) {
    s_isWhitelisted[account] = true;
    emit AddressWhitelisted(account);
  }

  /// @notice Add multiple addresses to whitelist
  /// @param accounts Array of addresses to whitelist
  function addToWhitelistBatch(address[] calldata accounts) external onlyRole(WHITELISTER_ROLE) {
    for (uint256 i = 0; i < accounts.length; i++) {
      s_isWhitelisted[accounts[i]] = true;
      emit AddressWhitelisted(accounts[i]);
    }
  }

  /// @notice Remove address from whitelist
  /// @param account Address to remove
  function removeFromWhitelist(address account) external onlyRole(WHITELISTER_ROLE) {
    s_isWhitelisted[account] = false;
    emit AddressRemovedFromWhitelist(account);
  }

  /// @notice Remove multiple addresses from whitelist
  /// @param accounts Array of addresses to remove
  function removeFromWhitelistBatch(address[] calldata accounts) external onlyRole(WHITELISTER_ROLE) {
    for (uint256 i = 0; i < accounts.length; i++) {
      s_isWhitelisted[accounts[i]] = false;
      emit AddressRemovedFromWhitelist(accounts[i]);
    }
  }

  /// @notice Check if an address is whitelisted
  /// @param account Address to check
  /// @return Whitelist status
  function isWhitelisted(address account) external view returns (bool) {
    return s_isWhitelisted[account];
  }

  /// @notice Get the current nonce for an account
  /// @param account Address to check
  /// @return Current nonce
  function getNonce(address account) external view returns (uint256) {
    return s_nonces[account];
  }
}
