import crypto from 'crypto';
import {
  TransactionType,
  UserRole,
  DiceRoundStatus,
  DiceRound,
  DiceRoundBet,
  DiceHistoryItem,
} from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';

export interface DiceBetInput {
  type: string; // '1'..'10' | 'small' | 'big' | 'even' | 'odd'
  amount: string;
}

export type DiceEventListener = (event: string, data: any) => void;

export class DiceEngine {
  private currentRound: DiceRound;
  private currentBets: Map<string, DiceRoundBet> = new Map();
  private userBetsMap: Map<string, string[]> = new Map();
  private history: DiceHistoryItem[] = [];
  private listeners: Set<DiceEventListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private simBetTimeouts: NodeJS.Timeout[] = [];
  private roundCount = 601;

  private BETTING_DURATION_MS = 14000; // 14 seconds betting phase
  private ROLLING_DURATION_MS = 4500;  // 4.5 seconds rolling phase
  private RESULT_DURATION_MS = 5000;   // 5.0 seconds celebration & settlement

  private serverSeed: string = '';
  private serverSeedHash: string = '';
  private clientSeed: string = 'client-seed-live';
  private winningNumber: number | null = null;

  constructor() {
    // Seed initial realistic 1 to 10 history (newest first)
    const seed = [4, 1, 9, 5, 8, 6, 2, 10, 3, 7];
    this.history = seed.map((num, idx) => ({
      roundNumber: this.roundCount - 1 - idx,
      rolledNumber: num,
      timestamp: new Date(Date.now() - (idx + 1) * 30000).toISOString(),
    }));

    this.currentRound = {
      id: `round-dice-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: DiceRoundStatus.BETTING,
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      rolledNumber: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
      numberBetsAmount: {},
    };

    // Start continuous multiplayer round loop
    this.startBettingPhase();
  }

  public subscribe(listener: DiceEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: string, data: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        // Ignore listener error
      }
    }
  }

  public getPublicRoundState(): DiceRound {
    return {
      ...this.currentRound,
      rolledNumber: this.currentRound.status === DiceRoundStatus.RESULT ? this.currentRound.rolledNumber : null,
    };
  }

  public getCurrentRoundBets(): DiceRoundBet[] {
    return Array.from(this.currentBets.values());
  }

  public getHistory(): DiceHistoryItem[] {
    return [...this.history];
  }

  public getServerSeedHash(): string {
    return this.serverSeedHash;
  }

  // --- 1. BETTING PHASE ---
  private startBettingPhase() {
    if (this.timer) clearTimeout(this.timer);
    this.simBetTimeouts.forEach((t) => clearTimeout(t));
    this.simBetTimeouts = [];

    this.roundCount++;
    this.currentBets.clear();
    this.userBetsMap.clear();

    // Generate fresh provably fair cryptographic seed for this round
    this.serverSeed = crypto.randomBytes(32).toString('hex');
    this.serverSeedHash = crypto.createHash('sha256').update(this.serverSeed).digest('hex');
    this.winningNumber = null;

    this.currentRound = {
      id: `round-dice-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: DiceRoundStatus.BETTING,
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      rolledNumber: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
      numberBetsAmount: {},
    };

    this.emit('dice:round_betting', {
      round: this.getPublicRoundState(),
      history: this.getHistory(),
      serverSeedHash: this.serverSeedHash,
    });

    // Schedule active online simulated community bets
    this.scheduleSimulatedCommunityBets();

    // Transition to ROLLING phase after timer expires
    this.timer = setTimeout(() => {
      this.startRollingPhase();
    }, this.BETTING_DURATION_MS);
  }

  // --- 2. ROLLING PHASE ---
  private startRollingPhase() {
    if (this.timer) clearTimeout(this.timer);
    this.simBetTimeouts.forEach((t) => clearTimeout(t));

    this.currentRound.status = DiceRoundStatus.ROLLING;
    this.currentRound.rolledNumber = null;
    this.winningNumber = null;

    this.emit('dice:round_rolling', {
      round: this.getPublicRoundState(),
    });

    // Pause for 3D dice tumbling and number cycle animation
    this.timer = setTimeout(() => {
      this.startResultPhase();
    }, this.ROLLING_DURATION_MS);
  }

  // --- 3. RESULT & SETTLEMENT PHASE ---
  private startResultPhase() {
    if (this.timer) clearTimeout(this.timer);

    // Calculate provably fair winning number (1 to 10) only after betting & rolling finish
    const hmac = crypto.createHmac('sha256', this.serverSeed);
    hmac.update(`${this.clientSeed}:${this.roundCount}`);
    const hash = hmac.digest('hex');
    const subHash = hash.substring(0, 8);
    const intVal = parseInt(subHash, 16);
    this.winningNumber = (intVal % 10) + 1; // 1 to 10

    this.currentRound.status = DiceRoundStatus.RESULT;
    this.currentRound.rolledNumber = this.winningNumber;

    const rolled = this.winningNumber;
    const winners: any[] = [];
    const poolWallet = db.getWallet(SYSTEM_WALLETS.DICE_POOL);

    for (const bet of this.currentBets.values()) {
      let won = false;
      let multiplier = 0;

      // 1. Exact Number 1 to 10 (9x Payout)
      const numVal = parseInt(bet.type, 10);
      if (!isNaN(numVal) && numVal >= 1 && numVal <= 10) {
        if (numVal === rolled) {
          won = true;
          multiplier = 9.0;
        }
      }
      // 2. Small 1 to 5 (2x Payout)
      else if (bet.type === 'small' && rolled <= 5) {
        won = true;
        multiplier = 2.0;
      }
      // 3. Big 6 to 10 (2x Payout)
      else if (bet.type === 'big' && rolled >= 6) {
        won = true;
        multiplier = 2.0;
      }
      // 4. Even (2, 4, 6, 8, 10) (2x Payout)
      else if (bet.type === 'even' && rolled % 2 === 0) {
        won = true;
        multiplier = 2.0;
      }
      // 5. Odd (1, 3, 5, 7, 9) (2x Payout)
      else if (bet.type === 'odd' && rolled % 2 !== 0) {
        won = true;
        multiplier = 2.0;
      }

      bet.won = won;

      if (won) {
        const betAmtNum = parseInt(bet.amount, 10);
        const payoutNum = Math.floor(betAmtNum * multiplier);
        const profitNum = payoutNum - betAmtNum;
        bet.payout = payoutNum.toString();
        bet.profit = profitNum.toString();

        winners.push({
          username: bet.username,
          userId: bet.userId,
          type: bet.type,
          amount: bet.amount,
          payout: bet.payout,
        });

        // Atomic payout from DICE_POOL to real player wallet
        if (!bet.userId.startsWith('sim-')) {
          const userWallet = db.getWalletByUserId(bet.userId);
          if (userWallet && poolWallet) {
            try {
              db.executeTransfer({
                sourceWalletId: SYSTEM_WALLETS.DICE_POOL,
                targetWalletId: userWallet.id,
                amount: payoutNum.toString(),
                type: TransactionType.BET_WIN_PAYOUT,
                idempotencyKey: `dice-live-win-${bet.id}-${Date.now()}`,
                description: `Lucky 10 Dice Win - Rolled #${rolled} on ${bet.type.toUpperCase()}`,
                metadata: { roundNumber: this.currentRound.roundNumber, rolledNumber: rolled, multiplier },
              });
            } catch (err: any) {
              console.error('Dice win transfer error:', err);
            }
          }
        }
      } else {
        bet.payout = '0';
        bet.profit = `-${bet.amount}`;
      }
    }

    // Add to history
    this.history.unshift({
      roundNumber: this.currentRound.roundNumber,
      rolledNumber: rolled,
      timestamp: new Date().toISOString(),
    });
    if (this.history.length > 25) this.history.pop();

    this.emit('dice:round_result', {
      round: this.getPublicRoundState(),
      rolledNumber: rolled,
      winners,
      history: this.getHistory(),
      serverSeed: this.serverSeed,
      poolBalance: poolWallet ? poolWallet.balance : '2000000',
    });

    // Schedule transition to next round
    this.timer = setTimeout(() => {
      this.startBettingPhase();
    }, this.RESULT_DURATION_MS);
  }

  // --- 4. PLAYER BET PLACEMENT ---
  public placeBet(params: {
    userId: string;
    username: string;
    userRole: UserRole;
    bets: DiceBetInput[];
  }) {
    if (this.currentRound.status !== DiceRoundStatus.BETTING) {
      throw new Error('Betting is closed for this round. Please wait for the next round.');
    }

    const userWallet = db.getWalletByUserId(params.userId);
    if (!userWallet) throw new Error('User wallet not found');

    let totalRequested = 0n;
    for (const b of params.bets) {
      const amt = BigInt(b.amount);
      if (amt <= 0n) throw new Error('Bet amount must be greater than 0');
      totalRequested += amt;
    }

    if (BigInt(userWallet.balance) < totalRequested) {
      throw new Error('Insufficient wallet balance to place bets');
    }

    // Deduct total bet atomically into DICE_POOL
    db.executeTransfer({
      sourceWalletId: userWallet.id,
      targetWalletId: SYSTEM_WALLETS.DICE_POOL,
      amount: totalRequested.toString(),
      type: TransactionType.BET_ESCROW_LOCK,
      idempotencyKey: `dice-live-bet-${params.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      description: `Lucky 10 Dice Bet - Round #${this.currentRound.roundNumber}`,
      metadata: { roundNumber: this.currentRound.roundNumber, betsCount: params.bets.length },
    });

    const createdBets: DiceRoundBet[] = [];
    for (const b of params.bets) {
      const betId = `dice-bet-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const roundBet: DiceRoundBet = {
        id: betId,
        roundId: this.currentRound.id,
        userId: params.userId,
        username: params.username,
        type: b.type,
        amount: b.amount,
        createdAt: new Date().toISOString(),
      };

      this.currentBets.set(betId, roundBet);
      createdBets.push(roundBet);

      this.currentRound.totalBetsCount++;
      this.currentRound.totalBetAmount = (
        BigInt(this.currentRound.totalBetAmount) + BigInt(b.amount)
      ).toString();

      const prevNumAmt = this.currentRound.numberBetsAmount[b.type] || '0';
      this.currentRound.numberBetsAmount[b.type] = (
        BigInt(prevNumAmt) + BigInt(b.amount)
      ).toString();

      const existing = this.userBetsMap.get(params.userId) || [];
      existing.push(betId);
      this.userBetsMap.set(params.userId, existing);
    }

    this.emit('dice:bet_placed', {
      roundId: this.currentRound.id,
      bets: createdBets,
      round: this.getPublicRoundState(),
    });

    return {
      success: true,
      placedBets: createdBets,
      updatedBalance: db.getWalletByUserId(params.userId)?.balance,
    };
  }

  // Simulated active community bets
  private scheduleSimulatedCommunityBets() {
    const simUsers = ['crypto_king', 'lucky_sam', 'raj_roller', 'blaze_99', 'anil_v', 'kavya_77'];
    const delays = [1500, 3500, 6000, 8500, 11000];

    delays.forEach((delay, idx) => {
      const t = setTimeout(() => {
        if (this.currentRound.status !== DiceRoundStatus.BETTING) return;
        const u = simUsers[idx % simUsers.length];
        const types = ['7', '3', '10', '5', 'small', 'big', 'even', 'odd', '1', '9'];
        const chosenType = types[Math.floor(Math.random() * types.length)];
        const amount = [50, 100, 200, 500][Math.floor(Math.random() * 4)].toString();

        const simBetId = `sim-dice-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const roundBet: DiceRoundBet = {
          id: simBetId,
          roundId: this.currentRound.id,
          userId: `sim-${u}`,
          username: u,
          type: chosenType,
          amount,
          createdAt: new Date().toISOString(),
        };

        this.currentBets.set(simBetId, roundBet);
        this.currentRound.totalBetsCount++;
        this.currentRound.totalBetAmount = (
          BigInt(this.currentRound.totalBetAmount) + BigInt(amount)
        ).toString();

        const prevNumAmt = this.currentRound.numberBetsAmount[chosenType] || '0';
        this.currentRound.numberBetsAmount[chosenType] = (
          BigInt(prevNumAmt) + BigInt(amount)
        ).toString();

        this.emit('dice:bet_placed', {
          roundId: this.currentRound.id,
          bets: [roundBet],
          round: this.getPublicRoundState(),
        });
      }, delay);

      this.simBetTimeouts.push(t);
    });
  }
}

export const diceEngine = new DiceEngine();
