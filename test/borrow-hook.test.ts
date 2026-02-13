import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BorrowHook } from '../types';

describe('Borrow Hook', function () {
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let borrowHook: BorrowHook;

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  beforeEach(async function () {
    [deployer, admin, user] = await ethers.getSigners();

    const BorrowHookFactory = await ethers.getContractFactory('BorrowHook');
    borrowHook = (await BorrowHookFactory.deploy(admin.address)) as BorrowHook;
    await borrowHook.deployed();
  });

  describe('BorrowHook', function () {
    it('should reject borrows when user not whitelisted', async function () {
      const result = await borrowHook.callStatic.beforeBorrow(
        user.address,
        user.address,
        ZERO_ADDRESS,
        1000,
        2
      );
      expect(result).to.equal(false);
    });

    it('should able to add whitelisted users', async function () {
      expect(await borrowHook.isWhitelisted(user.address)).to.equal(false);

      await borrowHook.connect(admin).addToWhitelist(user.address);
      expect(await borrowHook.isWhitelisted(user.address)).to.equal(true);

      await borrowHook.connect(admin).removeFromWhitelist(user.address);
      expect(await borrowHook.isWhitelisted(user.address)).to.equal(false);
    });

    it('should allow borrows for whitelisted users', async function () {
      await borrowHook.connect(admin).addToWhitelist(user.address);

      const result = await borrowHook.callStatic.beforeBorrow(
        user.address,
        user.address,
        ZERO_ADDRESS,
        1000,
        2
      );
      expect(result).to.equal(true);
    });

    it('should support batch whitelist operations', async function () {
      const [, , user1, user2, user3] = await ethers.getSigners();

      await borrowHook
        .connect(admin)
        .addToWhitelistBatch([user1.address, user2.address, user3.address]);

      expect(await borrowHook.isWhitelisted(user1.address)).to.equal(true);
      expect(await borrowHook.isWhitelisted(user2.address)).to.equal(true);
      expect(await borrowHook.isWhitelisted(user3.address)).to.equal(true);

      await borrowHook.connect(admin).removeFromWhitelistBatch([user1.address, user2.address]);

      expect(await borrowHook.isWhitelisted(user1.address)).to.equal(false);
      expect(await borrowHook.isWhitelisted(user2.address)).to.equal(false);
      expect(await borrowHook.isWhitelisted(user3.address)).to.equal(true);
    });

    it('should only allow whitelister to add to whitelist', async function () {
      await expect(borrowHook.connect(user).addToWhitelist(user.address)).to.be.reverted;
    });
  });

  describe('Signature-based Whitelist', function () {
    const WHITELIST_TYPEHASH = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(
        'WhitelistAuthorization(address account,uint256 nonce,uint256 deadline)'
      )
    );

    async function signWhitelistAuthorizationTypedData(
      signer: SignerWithAddress,
      account: string,
      nonce: number,
      deadline: number
    ) {
      const chainId = await signer.getChainId();

      const domain = {
        name: 'BorrowHook',
        version: '1',
        chainId: chainId,
        verifyingContract: borrowHook.address,
      };

      const types = {
        WhitelistAuthorization: [
          { name: 'account', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };

      const value = {
        account: account,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await signer._signTypedData(domain, types, value);
      const { v, r, s } = ethers.utils.splitSignature(signature);

      return { v, r, s };
    }

    it('should whitelist user with valid signature from signer', async function () {
      const nonce = await borrowHook.getNonce(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const { v, r, s } = await signWhitelistAuthorizationTypedData(
        admin,
        user.address,
        nonce.toNumber(),
        deadline
      );

      expect(await borrowHook.isWhitelisted(user.address)).to.equal(false);

      await borrowHook.connect(user).addToWhitelistWithSignature(user.address, deadline, v, r, s);

      expect(await borrowHook.isWhitelisted(user.address)).to.equal(true);
    });

    it('should increment nonce after successful signature whitelist', async function () {
      const nonceBefore = await borrowHook.getNonce(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const { v, r, s } = await signWhitelistAuthorizationTypedData(
        admin,
        user.address,
        nonceBefore.toNumber(),
        deadline
      );

      await borrowHook.connect(user).addToWhitelistWithSignature(user.address, deadline, v, r, s);

      const nonceAfter = await borrowHook.getNonce(user.address);
      expect(nonceAfter).to.equal(nonceBefore.add(1));
    });

    it('should reject expired signature', async function () {
      const nonce = await borrowHook.getNonce(user.address);
      const deadline = Math.floor(Date.now() / 1000) - 3600;

      const { v, r, s } = await signWhitelistAuthorizationTypedData(
        admin,
        user.address,
        nonce.toNumber(),
        deadline
      );

      await expect(
        borrowHook.connect(user).addToWhitelistWithSignature(user.address, deadline, v, r, s)
      ).to.be.revertedWithCustomError(borrowHook, 'SignatureExpired');
    });

    it('should reject signature from non-signer', async function () {
      const nonce = await borrowHook.getNonce(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // User signs (but user doesn't have SIGNER_ROLE)
      const { v, r, s } = await signWhitelistAuthorizationTypedData(
        user,
        user.address,
        nonce.toNumber(),
        deadline
      );

      await expect(
        borrowHook.connect(user).addToWhitelistWithSignature(user.address, deadline, v, r, s)
      ).to.be.revertedWithCustomError(borrowHook, 'InvalidSignature');
    });

    it('should reject signature with wrong nonce', async function () {
      const nonce = await borrowHook.getNonce(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const { v, r, s } = await signWhitelistAuthorizationTypedData(
        admin,
        user.address,
        nonce.toNumber() + 1,
        deadline
      );

      await expect(
        borrowHook.connect(user).addToWhitelistWithSignature(user.address, deadline, v, r, s)
      ).to.be.revertedWithCustomError(borrowHook, 'InvalidSignature');
    });

    it('should allow anyone to submit a valid signature on behalf of user', async function () {
      const nonce = await borrowHook.getNonce(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const { v, r, s } = await signWhitelistAuthorizationTypedData(
        admin,
        user.address,
        nonce.toNumber(),
        deadline
      );

      await borrowHook
        .connect(deployer)
        .addToWhitelistWithSignature(user.address, deadline, v, r, s);

      expect(await borrowHook.isWhitelisted(user.address)).to.equal(true);
    });
  });
});
