import './__setup.spec';
import { expect } from 'chai';
import { utils } from 'ethers';
import { impersonateAccountsHardhat } from '../helpers/misc-utils';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { topUpNonPayableWithEther } from './helpers/utils/funds';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { evmSnapshot, evmRevert } from '@aave/deploy-v3';
import { BorrowHook__factory } from '../types';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool: Borrow Hook', (testEnv: TestEnv) => {
  const { BORROW_HOOK_REJECTED } = ProtocolErrors;

  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snap);
  });

  it('Borrow succeeds when no hook is set', async () => {
    const { pool, dai, weth, users } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    await dai.connect(depositor.signer)['mint(uint256)'](utils.parseEther('10000'));
    await dai.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(dai.address, utils.parseEther('10000'), depositor.address, 0);

    await weth
      .connect(borrower.signer)
      ['mint(address,uint256)'](borrower.address, utils.parseEther('10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('10'), borrower.address, 0);

    expect(await pool.getBorrowHook()).to.equal(ZERO_ADDRESS);

    const borrowAmount = await convertToCurrencyDecimals(dai.address, '100');
    await expect(
      pool
        .connect(borrower.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.not.be.reverted;
  });

  it('Borrow is rejected when hook is set and user is not whitelisted', async () => {
    const { pool, dai, weth, deployer, configurator, users } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    await dai.connect(depositor.signer)['mint(uint256)'](utils.parseEther('10000'));
    await dai.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(dai.address, utils.parseEther('10000'), depositor.address, 0);

    await weth
      .connect(borrower.signer)
      ['mint(address,uint256)'](borrower.address, utils.parseEther('10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('10'), borrower.address, 0);

    const borrowHook = await new BorrowHook__factory(deployer.signer).deploy(deployer.address);
    await borrowHook.deployed();

    await topUpNonPayableWithEther(deployer.signer, [configurator.address], utils.parseEther('1'));
    await impersonateAccountsHardhat([configurator.address]);
    const configSigner = await hre.ethers.getSigner(configurator.address);
    await pool.connect(configSigner).setBorrowHook(borrowHook.address);

    expect(await pool.getBorrowHook()).to.equal(borrowHook.address);

    expect(await borrowHook.isWhitelisted(borrower.address)).to.equal(false);

    const borrowAmount = await convertToCurrencyDecimals(dai.address, '100');
    await expect(
      pool
        .connect(borrower.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(BORROW_HOOK_REJECTED);
  });

  it('Borrow succeeds when hook is set and user is whitelisted', async () => {
    const { pool, dai, weth, deployer, configurator, users } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    await dai.connect(depositor.signer)['mint(uint256)'](utils.parseEther('10000'));
    await dai.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(dai.address, utils.parseEther('10000'), depositor.address, 0);

    await weth
      .connect(borrower.signer)
      ['mint(address,uint256)'](borrower.address, utils.parseEther('10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('10'), borrower.address, 0);

    const borrowHook = await new BorrowHook__factory(deployer.signer).deploy(deployer.address);
    await borrowHook.deployed();

    await borrowHook.connect(deployer.signer).addToWhitelist(borrower.address);
    expect(await borrowHook.isWhitelisted(borrower.address)).to.equal(true);

    await topUpNonPayableWithEther(deployer.signer, [configurator.address], utils.parseEther('1'));
    await impersonateAccountsHardhat([configurator.address]);
    const configSigner = await hre.ethers.getSigner(configurator.address);
    await pool.connect(configSigner).setBorrowHook(borrowHook.address);

    const borrowAmount = await convertToCurrencyDecimals(dai.address, '100');
    await expect(
      pool
        .connect(borrower.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.not.be.reverted;
  });

  it('Borrow on behalf of user checks onBehalfOf address for whitelist', async () => {
    const { pool, dai, weth, deployer, configurator, variableDebtDai, users } = testEnv;
    const depositor = users[0];
    const borrower = users[1];
    const executor = users[2];

    await dai.connect(depositor.signer)['mint(uint256)'](utils.parseEther('10000'));
    await dai.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(dai.address, utils.parseEther('10000'), depositor.address, 0);

    await weth
      .connect(borrower.signer)
      ['mint(address,uint256)'](borrower.address, utils.parseEther('10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('10'), borrower.address, 0);

    const borrowHook = await new BorrowHook__factory(deployer.signer).deploy(deployer.address);
    await borrowHook.deployed();

    await borrowHook.connect(deployer.signer).addToWhitelist(executor.address);
    expect(await borrowHook.isWhitelisted(executor.address)).to.equal(true);
    expect(await borrowHook.isWhitelisted(borrower.address)).to.equal(false);

    await topUpNonPayableWithEther(deployer.signer, [configurator.address], utils.parseEther('1'));
    await impersonateAccountsHardhat([configurator.address]);
    const configSigner = await hre.ethers.getSigner(configurator.address);
    await pool.connect(configSigner).setBorrowHook(borrowHook.address);

    const borrowAmount = await convertToCurrencyDecimals(dai.address, '100');
    await variableDebtDai
      .connect(borrower.signer)
      .approveDelegation(executor.address, borrowAmount);

    await expect(
      pool
        .connect(executor.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(BORROW_HOOK_REJECTED);

    await borrowHook.connect(deployer.signer).addToWhitelist(borrower.address);

    await expect(
      pool
        .connect(executor.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.not.be.reverted;
  });

  it('Borrow hook can be removed by setting to zero address', async () => {
    const { pool, dai, weth, deployer, configurator, users } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    await dai.connect(depositor.signer)['mint(uint256)'](utils.parseEther('10000'));
    await dai.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(dai.address, utils.parseEther('10000'), depositor.address, 0);

    await weth
      .connect(borrower.signer)
      ['mint(address,uint256)'](borrower.address, utils.parseEther('10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('10'), borrower.address, 0);

    const borrowHook = await new BorrowHook__factory(deployer.signer).deploy(deployer.address);
    await borrowHook.deployed();

    await topUpNonPayableWithEther(deployer.signer, [configurator.address], utils.parseEther('1'));
    await impersonateAccountsHardhat([configurator.address]);
    const configSigner = await hre.ethers.getSigner(configurator.address);
    await pool.connect(configSigner).setBorrowHook(borrowHook.address);

    const borrowAmount = await convertToCurrencyDecimals(dai.address, '100');
    await expect(
      pool
        .connect(borrower.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(BORROW_HOOK_REJECTED);

    await pool.connect(configSigner).setBorrowHook(ZERO_ADDRESS);
    expect(await pool.getBorrowHook()).to.equal(ZERO_ADDRESS);

    await expect(
      pool
        .connect(borrower.signer)
        .borrow(dai.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.not.be.reverted;
  });
});
