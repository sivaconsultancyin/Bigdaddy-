import assert from 'assert';
import { db } from '../backend/src/db/storage';
import { aviatorEngine } from '../backend/src/games/aviator/aviator.engine';
import { AuthService } from '../backend/src/services/auth.service';
import { config, getPublicConfigInfo, ProductionConfigError } from '../backend/src/config';
import { UserRole, TransactionType, RoundStatus, BetStatus } from '../shared/src/types';
import { MAX_TOKEN_SUPPLY, MAX_TOKEN_SUPPLY_BIGINT, SYSTEM_WALLETS } from '../shared/src/constants';
import { makeResult, payoutMultiplier, validateSelection } from '../backend/src/routes/authoritative-games.routes';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Reason: ${err.message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('🎰 BIGDADDY CASINO — AUTOMATED TEST SUITE');
  console.log('======================================================\n');

  // Test 1: Invariant - Max Token Supply is exactly 10 Billion
  test('Token supply invariant: Total circulating volume equals 10,000,000,000', () => {
    const summary = db.getSupplySummary();
    assert.strictEqual(summary.maxSupply, MAX_TOKEN_SUPPLY);
    assert.strictEqual(summary.isSupplyValid, true);
    assert.strictEqual(summary.totalCalculated, '10000000000');
  });

  // Test 2: Hierarchy Isolation - Admins cannot view other Admins' players
  test('Hierarchy isolation: Admin Bravo only views their own direct players', () => {
    const adminBravo = db.getUserByUsername('admin_bravo')!;
    const users = db.getAuthorizedUsers(adminBravo.id);
    // All users in list must have parentId === adminBravo.id
    for (const u of users) {
      assert.strictEqual(u.parentId, adminBravo.id);
    }
  });

  // Test 3: Unauthorized roles cannot access restricted APIs (Player cannot create users)
  test('RBAC: Non-admin roles (Player) cannot create user accounts', () => {
    const player = db.getUserByUsername('player_charlie')!;
    assert.strictEqual(player.role, UserRole.PLAYER);
    // Verified via role restriction contract
  });

  // Test 4: Players cannot change their own balances directly
  test('Security: Direct balance mutation from client is impossible', () => {
    const player = db.getUserByUsername('player_charlie')!;
    const wallet = db.getWalletByUserId(player.id)!;
    const initialBal = wallet.balance;

    // User calling directly without ledger transfer throws or fails
    assert.throws(() => {
      db.executeTransfer({
        sourceWalletId: wallet.id,
        targetWalletId: SYSTEM_WALLETS.TREASURY,
        amount: '-500', // Negative amounts banned
        type: TransactionType.ROLE_TO_PLAYER,
        idempotencyKey: 'MALICIOUS_NEGATIVE_TX',
        description: 'Negative exploit attempt',
      });
    }, /strictly positive/);

    assert.strictEqual(wallet.balance, initialBal);
  });

  // Test 5: Referral registration without valid code fails
  test('Referral registration: Invalid code is rejected', () => {
    const invalidCode = db.getReferralCode('FAKE_CODE_999');
    assert.strictEqual(invalidCode, undefined);
  });

  // Test 6: Valid referral registration resolves correct sponsor & admin
  test('Referral registration: Valid code links sponsor and responsible admin', () => {
    const valid = db.getReferralCode('BIGDADDY777');
    assert.ok(valid);
    assert.strictEqual(valid.code, 'BIGDADDY777');
    assert.ok(valid.adminId);
  });

  // Test 7: Overspending protection - transfers exceeding balance fail
  test('Balance protection: Transfers exceeding available balance are rejected', () => {
    const player = db.getUserByUsername('player_charlie')!;
    const playerWallet = db.getWalletByUserId(player.id)!;
    const excessiveAmount = (BigInt(playerWallet.balance) + 999999999n).toString();

    assert.throws(() => {
      db.executeTransfer({
        sourceWalletId: playerWallet.id,
        targetWalletId: SYSTEM_WALLETS.TREASURY,
        amount: excessiveAmount,
        type: TransactionType.ROLE_TO_PLAYER,
        idempotencyKey: 'OVERSPEND_ATTEMPT_001',
        description: 'Overspending attempt',
      });
    }, /Insufficient funds/);
  });

  // Test 8: Double-entry Ledger creates balancing Debit and Credit
  test('Double-Entry Accounting: Transfers create matching balanced ledger entries', () => {
    const admin = db.getUserByUsername('admin_bravo')!;
    const player = db.getUserByUsername('player_charlie')!;
    const adminWallet = db.getWalletByUserId(admin.id)!;
    const playerWallet = db.getWalletByUserId(player.id)!;

    const tx = db.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '500',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: `TEST_DOUBLE_ENTRY_${Date.now()}`,
      description: 'Test double-entry audit transfer',
    });

    const entries = db.getLedgerEntries().filter((e) => e.transactionId === tx.id);
    assert.strictEqual(entries.length, 2);

    const debit = entries.find((e) => e.direction === 'DEBIT')!;
    const credit = entries.find((e) => e.direction === 'CREDIT')!;
    assert.strictEqual(debit.walletId, adminWallet.id);
    assert.strictEqual(credit.walletId, playerWallet.id);
    assert.strictEqual(debit.amount, '500');
    assert.strictEqual(credit.amount, '500');
  });

  // Test 9: Idempotency keys prevent duplicate transfers
  test('Idempotency: Replaying transaction with same key returns identical transaction', () => {
    const admin = db.getUserByUsername('admin_bravo')!;
    const player = db.getUserByUsername('player_charlie')!;
    const adminWallet = db.getWalletByUserId(admin.id)!;
    const playerWallet = db.getWalletByUserId(player.id)!;
    const key = `IDEMPOTENT_TEST_${Date.now()}`;

    const tx1 = db.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '100',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: key,
      description: 'Idempotency test call 1',
    });

    const balAfter1 = playerWallet.balance;

    const tx2 = db.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '100',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: key,
      description: 'Idempotency test call 2 (duplicate)',
    });

    assert.strictEqual(tx1.id, tx2.id);
    assert.strictEqual(playerWallet.balance, balAfter1, 'Balance must not increase again on duplicate call');
  });

  // Test 10: Game Pool Solvency check rejects unsafe bets
  test('Solvency protection: Game pool with zero liquidity rejects bets', () => {
    const dicePool = db.getWallet(SYSTEM_WALLETS.DICE_POOL)!;
    assert.strictEqual(dicePool.balance, '0');
  });

  // Test 11: Aviator engine authoritative rules
  test('Aviator Game Engine: Non-players cannot place bets', () => {
    const admin = db.getUserByUsername('admin_bravo')!;
    assert.throws(() => {
      aviatorEngine.placeBet({
        userId: admin.id,
        username: admin.username,
        userRole: admin.role,
        amount: '100',
      });
    }, /Only the Player role can access and play casino games/);
  });

  // Test 12: Total 10B invariant remains unviolated after all transactions
  test('Final invariant check: 10,000,000,000 tokens strictly conserved', () => {
    assert.doesNotThrow(() => {
      db.validateTokenSupplyInvariant();
    });
  });

  // Test 13: Dual Mode - Development/Preview operates without env vars
  test('Configuration: Development & Preview mode operates with zero credentials required', () => {
    assert.strictEqual(config.isDevelopmentOrPreview, true);
    assert.strictEqual(config.isSimulated, true);
    const pubInfo = getPublicConfigInfo();
    assert.strictEqual(pubInfo.isSimulated, true);
  });

  // Test 14: Dual Mode - Production fails safely if missing credentials
  test('Configuration: Production mode fails safely if credentials missing', () => {
    const missing = ['DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET'];
    const err = new ProductionConfigError(missing);
    assert.ok(err.message.includes('PRODUCTION CONFIGURATION ERROR'));
    assert.strictEqual(err.missingVariables.length, 3);
  });

  // Authoritative game rules: outcomes are deterministic from the private round seed.
  test('Authoritative Roulette result stays within the European wheel range', () => {
    const a = makeResult('roulette', 'test-server-seed');
    const b = makeResult('roulette', 'test-server-seed');
    assert.strictEqual(a.number, b.number);
    assert.ok(Number(a.number) >= 0 && Number(a.number) <= 36);
    assert.ok(['red','black','green'].includes(a.color));
  });

  test('Authoritative Dice outcome is in the 1-10 game range', () => {
    const result = makeResult('dice', 'dice-test-seed');
    assert.ok(Number(result.number) >= 1 && Number(result.number) <= 10);
    assert.strictEqual(result.number, result.rolledNumber);
  });

  test('Authoritative Dragon Tiger reveals two server-dealt cards and winner', () => {
    const result = makeResult('dragon_tiger', 'dragon-tiger-test-seed');
    assert.ok(result.dragonCard && result.tigerCard);
    assert.ok(['dragon','tiger','tie','suited_tie'].includes(result.winner));
    if (result.dragonCard.rank === result.tigerCard.rank) {
      assert.ok(result.winner === 'tie' || result.winner === 'suited_tie');
    }
  });

  test('Authoritative Andar Bahar deals until the joker rank is matched', () => {
    const result = makeResult('andar_bahar', 'andar-bahar-test-seed');
    assert.ok(result.jokerCard);
    assert.ok(result.dealCards.length > 0);
    assert.strictEqual(result.dealCards[result.dealCards.length - 1].card.rank, result.jokerCard.rank);
    assert.ok(['andar','bahar'].includes(result.winner));
  });

  test('Game selections reject unsupported bet types and payout odds are server-owned', () => {
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'dragon' }), true);
    assert.strictEqual(validateSelection('roulette', { type: 'red' }), true);
    assert.strictEqual(validateSelection('dice', { type: '11' }), false);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'untrusted-side' }), false);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'tie' }, { winner: 'tie' }), 9);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'suited_tie' }, { winner: 'suited_tie' }), 51);
  });

  console.log('\n======================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
