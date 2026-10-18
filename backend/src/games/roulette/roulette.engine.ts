import crypto from 'crypto';
import {
  TransactionType,
  UserRole,
  RouletteRoundStatus,
  RouletteRound,
  RouletteRoundBet,
} from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const BLACK_NUMBERS = new Set([
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
]);

export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export interface RouletteBetInput {
  id?: string;
  type: string;
  numbers: number[];
  amount: string;
}

export interface RouletteWinner {
  username: string;
  userId: string;
  totalBet: string;
  totalPayout: string;
  netProfit: string;
}

export type RouletteEventListener = (event: string, data: any) => void;

export class RouletteEngine {
  private currentRound: RouletteRound;
  private currentBets: Map<string, RouletteRoundBet> = new Map();
  private userBetsMap: Map<string, string[]> = new Map(); // userId -> betId[]
  private history: Array<{ number: number; color: 'red' | 'black' | 'green'; timestamp: string }> = [];
  private listeners: Set<RouletteEventListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private simBetTimeouts: NodeJS.Timeout[] = [];
  private roundCount = 420;
  private BETTING_DURATION_MS = 14000; // 14 seconds betting countdown
  private SPIN_DURATION_MS = 9500;     // 9.5 seconds wheel spinning
  private RESULT_DURATION_MS = 5500;   // 5.5 seconds celebration and result showcase
  private lastSettledWinners: RouletteWinner[] = [];

  constructor() {
    // Seed initial realistic casino history
    const seedNumbers = [17, 32, 0, 7, 23, 14, 2, 35, 9, 26, 18, 29];
    this.history = seedNumbers.map((n) => ({
      number: n,
      color: this.getNumberColor(n),
      timestamp: new Date().toISOString(),
    }));

    // Initialize first round
    this.currentRound = {
      id: `round-roulette-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: RouletteRoundStatus.BETTING,
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      spinEndsAt: null,
      winningNumber: null,
      color: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
    };

    // Start continuous automatic round loop
    this.startBettingPhase();
  }

  public subscribe(listener: RouletteEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: string, data: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        // Ignore listener exceptions
      }
    }
  }

  public getNumberColor(num: number): 'red' | 'black' | 'green' {
    if (num === 0) return 'green';
    return RED_NUMBERS.has(num) ? 'red' : 'black';
  }

  public getHistory() {
    return [...this.history];
  }

  public getMultiplier(type: string): number {
    switch (type) {
      case 'straight':
        return 36; // 35 to 1 payout
      case 'split':
        return 18; // 17 to 1
      case 'street':
        return 12; // 11 to 1
      case 'corner':
        return 9;  // 8 to 1
      case 'line':
        return 6;  // 5 to 1
      case 'col1':
      case 'col2':
      case 'col3':
      case 'dozen1':
      case 'dozen2':
      case 'dozen3':
        return 3;  // 2 to 1
      case 'red':
      case 'black':
      case 'even':
      case 'odd':
      case 'low':
      case 'high':
        return 2;  // 1 to 1
      default:
        return 0;
    }
  }

  public checkBetWin(bet: { type: string; numbers: number[] }, winningNumber: number): boolean {
    const { type, numbers } = bet;

    // Number 0 only wins on straight or combination bets containing 0
    if (winningNumber === 0) {
      if (type === 'straight' && numbers.includes(0)) return true;
      if ((type === 'split' || type === 'street' || type === 'corner') && numbers.includes(0)) return true;
      return false;
    }

    switch (type) {
      case 'straight':
      case 'split':
      case 'street':
      case 'corner':
      case 'line':
        return numbers.includes(winningNumber);

      case 'red':
        return RED_NUMBERS.has(winningNumber);

      case 'black':
        return BLACK_NUMBERS.has(winningNumber);

      case 'even':
        return winningNumber % 2 === 0;

      case 'odd':
        return winningNumber % 2 !== 0;

      case 'low':
        return winningNumber >= 1 && winningNumber <= 18;

      case 'high':
        return winningNumber >= 19 && winningNumber <= 36;

      case 'dozen1':
        return winningNumber >= 1 && winningNumber <= 12;

      case 'dozen2':
        return winningNumber >= 13 && winningNumber <= 24;

      case 'dozen3':
        return winningNumber >= 25 && winningNumber <= 36;

      case 'col1':
        return winningNumber % 3 === 1;

      case 'col2':
        return winningNumber % 3 === 2;

      case 'col3':
        return winningNumber % 3 === 0;

      default:
        return false;
    }
  }

  // ==========================================
  // CONTINUOUS AUTOMATED ROUND LIFECYCLE
  // ==========================================

  private startBettingPhase() {
    this.roundCount++;
    this.currentBets.clear();
    this.userBetsMap.clear();
    this.clearSimTimeouts();

    const now = Date.now();
    this.currentRound = {
      id: `round-roulette-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: RouletteRoundStatus.BETTING,
      bettingEndsAt: now + this.BETTING_DURATION_MS,
      spinEndsAt: null,
      winningNumber: null,
      color: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
    };

    this.emit('roulette:round_betting', {
      round: this.getPublicRoundState(),
      history: this.history.slice(0, 15),
    });

    // Schedule live simulated community player bets to create realistic casino atmosphere
    this.scheduleSimulatedBets();

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.startSpinningPhase();
    }, this.BETTING_DURATION_MS);
  }

  private clearSimTimeouts() {
    for (const t of this.simBetTimeouts) {
      clearTimeout(t);
    }
    this.simBetTimeouts = [];
  }

  private scheduleSimulatedBets() {
    const simPlayers = [
      { name: 'arjun_pro', bets: [{ type: 'red', numbers: [], amount: '100' }] },
      { name: 'lucky_strike', bets: [{ type: 'dozen2', numbers: [], amount: '50' }, { type: 'straight', numbers: [17], amount: '20' }] },
      { name: 'vegas_king', bets: [{ type: 'black', numbers: [], amount: '250' }] },
      { name: 'priya_99', bets: [{ type: 'even', numbers: [], amount: '50' }] },
      { name: 'rahul_ace', bets: [{ type: 'high', numbers: [], amount: '150' }, { type: 'col1', numbers: [], amount: '50' }] },
    ];

    const delays = [2500, 5500, 8500, 11000];
    delays.forEach((delay, idx) => {
      const timeout = setTimeout(() => {
        if (this.currentRound.status !== RouletteRoundStatus.BETTING) return;
        const player = simPlayers[idx % simPlayers.length];
        for (const b of player.bets) {
          const betId = `sim-bet-${player.name}-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
          const roundBet: RouletteRoundBet = {
            id: betId,
            roundId: this.currentRound.id,
            userId: `sim-${player.name}`,
            username: player.name,
            type: b.type,
            numbers: b.numbers,
            amount: b.amount,
            createdAt: new Date().toISOString(),
          };
          this.currentBets.set(betId, roundBet);
          const currentTotal = BigInt(this.currentRound.totalBetAmount) + BigInt(b.amount);
          this.currentRound.totalBetAmount = currentTotal.toString();
          this.currentRound.totalBetsCount = this.currentBets.size;

          this.emit('roulette:bet_placed', {
            roundId: this.currentRound.id,
            bet: {
              id: betId,
              username: player.name,
              type: b.type,
              numbers: b.numbers,
              amount: b.amount,
            },
            totalBetsCount: this.currentBets.size,
            totalBetAmount: this.currentRound.totalBetAmount,
          });
        }
      }, delay);
      this.simBetTimeouts.push(timeout);
    });
  }

  private startSpinningPhase() {
    this.clearSimTimeouts();

    // Generate provably-fair winning number (0 - 36)
    const winningNumber = crypto.randomInt(0, 37);
    const color = this.getNumberColor(winningNumber);
    const now = Date.now();

    this.currentRound.status = RouletteRoundStatus.SPINNING;
    this.currentRound.winningNumber = winningNumber;
    this.currentRound.color = color;
    this.currentRound.spinEndsAt = now + this.SPIN_DURATION_MS;

    this.emit('roulette:round_spinning', {
      round: this.getPublicRoundState(),
      winningNumber,
      color,
      spinDurationMs: this.SPIN_DURATION_MS,
      spinEndsAt: this.currentRound.spinEndsAt,
      totalBetsCount: this.currentRound.totalBetsCount,
      totalBetAmount: this.currentRound.totalBetAmount,
    });

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.handleResultPhase();
    }, this.SPIN_DURATION_MS);
  }

  private handleResultPhase() {
    this.currentRound.status = RouletteRoundStatus.RESULT;
    const winningNumber = this.currentRound.winningNumber ?? 0;
    const color = this.currentRound.color ?? this.getNumberColor(winningNumber);

    // Group bets by player for atomic settlements
    const userBetsGroup = new Map<string, RouletteRoundBet[]>();
    for (const bet of this.currentBets.values()) {
      const list = userBetsGroup.get(bet.userId) || [];
      list.push(bet);
      userBetsGroup.set(bet.userId, list);
    }

    const winnersSummary: RouletteWinner[] = [];

    // Authoritative settlement for each user
    for (const [userId, bets] of userBetsGroup.entries()) {
      const isSimulated = userId.startsWith('sim-');
      const playerWallet = isSimulated ? null : db.getWalletByUserId(userId);
      const username = bets[0]?.username || 'Player';

      let totalBetBigInt = 0n;
      let totalPayoutBigInt = 0n;
      let winningEscrowRefundBigInt = 0n;
      let winningPoolNetWinBigInt = 0n;
      let losingEscrowBigInt = 0n;

      for (const bet of bets) {
        const stakeBigInt = BigInt(bet.amount);
        totalBetBigInt += stakeBigInt;
        const won = this.checkBetWin(bet, winningNumber);
        const mult = this.getMultiplier(bet.type);

        if (won && mult > 0) {
          const multBigInt = BigInt(mult);
          const payoutBigInt = stakeBigInt * multBigInt;
          const profitBigInt = payoutBigInt - stakeBigInt;

          totalPayoutBigInt += payoutBigInt;
          winningEscrowRefundBigInt += stakeBigInt;
          winningPoolNetWinBigInt += profitBigInt;

          bet.won = true;
          bet.payout = payoutBigInt.toString();
          bet.profit = profitBigInt.toString();
        } else {
          losingEscrowBigInt += stakeBigInt;
          bet.won = false;
          bet.payout = '0';
          bet.profit = `-${bet.amount}`;
        }
      }

      // Execute atomic ledger movements for real players
      if (!isSimulated && playerWallet) {
        const spinId = `${this.currentRound.id}-${userId}`;

        // 1. Refund winning stakes from Escrow
        if (winningEscrowRefundBigInt > 0n) {
          db.executeTransfer({
            sourceWalletId: SYSTEM_WALLETS.BET_ESCROW,
            targetWalletId: playerWallet.id,
            amount: winningEscrowRefundBigInt.toString(),
            type: TransactionType.BET_ESCROW_REFUND,
            idempotencyKey: `ROULETTE_REFUND_${spinId}`,
            description: `Roulette Round #${this.currentRound.roundNumber} Winning Stakes Refund`,
            metadata: { roundId: this.currentRound.id, winningNumber },
          });
        }

        // 2. Pay net winnings from Roulette Game Pool
        if (winningPoolNetWinBigInt > 0n) {
          db.executeTransfer({
            sourceWalletId: SYSTEM_WALLETS.ROULETTE_POOL,
            targetWalletId: playerWallet.id,
            amount: winningPoolNetWinBigInt.toString(),
            type: TransactionType.BET_WIN_PAYOUT,
            idempotencyKey: `ROULETTE_WIN_${spinId}`,
            description: `Roulette Round #${this.currentRound.roundNumber} Payout (Number ${winningNumber})`,
            metadata: { roundId: this.currentRound.id, winningNumber },
          });
        }

        // 3. Transfer losing bets from Escrow to Owner Treasury
        if (losingEscrowBigInt > 0n) {
          db.executeTransfer({
            sourceWalletId: SYSTEM_WALLETS.BET_ESCROW,
            targetWalletId: SYSTEM_WALLETS.TREASURY,
            amount: losingEscrowBigInt.toString(),
            type: TransactionType.BET_LOSS_TREASURY,
            idempotencyKey: `ROULETTE_LOSS_${spinId}`,
            description: `Roulette Round #${this.currentRound.roundNumber} House Edge / Loss to Treasury`,
            metadata: { roundId: this.currentRound.id, winningNumber },
          });
        }
      }

      if (totalPayoutBigInt > 0n) {
        winnersSummary.push({
          username,
          userId,
          totalBet: totalBetBigInt.toString(),
          totalPayout: totalPayoutBigInt.toString(),
          netProfit: (totalPayoutBigInt - totalBetBigInt).toString(),
        });
      }
    }

    // Push winning number to history
    this.history.unshift({
      number: winningNumber,
      color,
      timestamp: new Date().toISOString(),
    });
    if (this.history.length > 30) {
      this.history.pop();
    }

    this.lastSettledWinners = winnersSummary;

    // Get current pool balance
    const poolWallet = db.getWallet(SYSTEM_WALLETS.ROULETTE_POOL);
    const poolBalance = poolWallet ? poolWallet.balance : '2000000';

    this.emit('roulette:round_result', {
      round: this.getPublicRoundState(),
      winningNumber,
      color,
      isEven: winningNumber !== 0 && winningNumber % 2 === 0,
      isOdd: winningNumber !== 0 && winningNumber % 2 !== 0,
      isLow: winningNumber >= 1 && winningNumber <= 18,
      isHigh: winningNumber >= 19 && winningNumber <= 36,
      dozen: winningNumber === 0 ? null : winningNumber <= 12 ? 1 : winningNumber <= 24 ? 2 : 3,
      column: winningNumber === 0 ? null : winningNumber % 3 === 1 ? 1 : winningNumber % 3 === 2 ? 2 : 3,
      winners: winnersSummary,
      history: this.history.slice(0, 15),
      poolBalance,
    });

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.startBettingPhase();
    }, this.RESULT_DURATION_MS);
  }

  // ==========================================
  // PLAYER BET PLACEMENT IN CURRENT ROUND
  // ==========================================

  public placeBet(params: {
    userId: string;
    username: string;
    userRole: UserRole;
    bets: RouletteBetInput[];
  }) {
    // 1. Role validation
    if (params.userRole !== UserRole.PLAYER) {
      throw new Error('Only Player accounts can place bets on casino games');
    }

    // 2. Round phase validation
    if (this.currentRound.status !== RouletteRoundStatus.BETTING) {
      const remainingSec = this.currentRound.spinEndsAt
        ? Math.max(1, Math.ceil((this.currentRound.spinEndsAt - Date.now()) / 1000))
        : 5;
      throw new Error(`Round in progress (Wheel is spinning). Next betting round starts in ${remainingSec}s!`);
    }

    if (!params.bets || params.bets.length === 0) {
      throw new Error('At least one bet is required');
    }

    // 3. Compute total bet amount
    let totalBetBigInt = 0n;
    for (const bet of params.bets) {
      const amt = BigInt(bet.amount);
      if (amt <= 0n) {
        throw new Error('Each bet amount must be greater than zero');
      }
      totalBetBigInt += amt;
    }

    const minBet = 10n;
    const maxBet = 250000n;
    if (totalBetBigInt < minBet) {
      throw new Error(`Minimum total bet is ${minBet} tokens`);
    }
    if (totalBetBigInt > maxBet) {
      throw new Error(`Maximum total bet is ${maxBet} tokens`);
    }

    // 4. Pool solvency check
    const poolWallet = db.getWallet(SYSTEM_WALLETS.ROULETTE_POOL);
    if (!poolWallet) {
      throw new Error('European Roulette Game Pool is unavailable');
    }
    const poolBalanceBigInt = BigInt(poolWallet.balance);
    if (poolBalanceBigInt < totalBetBigInt * 36n && poolBalanceBigInt < totalBetBigInt * 2n) {
      throw new Error('Roulette Game Pool liquidity is currently low. Please contact Admin.');
    }

    // 5. Player balance check
    const playerWallet = db.getWalletByUserId(params.userId);
    if (!playerWallet) {
      throw new Error('Player wallet not found');
    }
    const playerBalance = BigInt(playerWallet.balance);
    if (playerBalance < totalBetBigInt) {
      throw new Error(`Insufficient balance: available ${playerBalance}, required ${totalBetBigInt}`);
    }

    // 6. Escrow atomic lock of total bet
    const lockId = `${this.currentRound.id}-${params.userId}-${Date.now()}`;
    db.executeTransfer({
      sourceWalletId: playerWallet.id,
      targetWalletId: SYSTEM_WALLETS.BET_ESCROW,
      amount: totalBetBigInt.toString(),
      type: TransactionType.BET_ESCROW_LOCK,
      idempotencyKey: `ROULETTE_LOCK_${lockId}`,
      description: `European Roulette Round #${this.currentRound.roundNumber} Stake Escrowed`,
      metadata: { roundId: this.currentRound.id, betCount: params.bets.length },
    });

    // 7. Store placed bets in current round
    const userBetIds: string[] = this.userBetsMap.get(params.userId) || [];
    const addedBets: RouletteRoundBet[] = [];

    for (const b of params.bets) {
      const betId = b.id || `bet-${params.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const roundBet: RouletteRoundBet = {
        id: betId,
        roundId: this.currentRound.id,
        userId: params.userId,
        username: params.username,
        type: b.type,
        numbers: b.numbers,
        amount: b.amount,
        createdAt: new Date().toISOString(),
      };
      this.currentBets.set(betId, roundBet);
      userBetIds.push(betId);
      addedBets.push(roundBet);
    }
    this.userBetsMap.set(params.userId, userBetIds);

    // Update round totals
    const currentRoundTotal = BigInt(this.currentRound.totalBetAmount) + totalBetBigInt;
    this.currentRound.totalBetAmount = currentRoundTotal.toString();
    this.currentRound.totalBetsCount = this.currentBets.size;

    // Broadcast bet placement to all connected multiplayer clients
    this.emit('roulette:bet_placed', {
      roundId: this.currentRound.id,
      username: params.username,
      totalAmount: totalBetBigInt.toString(),
      betCount: params.bets.length,
      totalBetsCount: this.currentBets.size,
      totalBetAmount: this.currentRound.totalBetAmount,
    });

    const updatedWallet = db.getWalletByUserId(params.userId);

    return {
      success: true,
      roundId: this.currentRound.id,
      roundNumber: this.currentRound.roundNumber,
      betCount: addedBets.length,
      totalBet: totalBetBigInt.toString(),
      remainingBalance: updatedWallet ? updatedWallet.balance : (playerBalance - totalBetBigInt).toString(),
      bets: addedBets,
    };
  }

  // ==========================================
  // PUBLIC STATE RETRIEVAL
  // ==========================================

  public getPublicRoundState() {
    return {
      id: this.currentRound.id,
      roundNumber: this.currentRound.roundNumber,
      status: this.currentRound.status,
      bettingEndsAt: this.currentRound.bettingEndsAt,
      spinEndsAt: this.currentRound.spinEndsAt,
      winningNumber:
        this.currentRound.status === RouletteRoundStatus.BETTING
          ? null
          : this.currentRound.winningNumber,
      color:
        this.currentRound.status === RouletteRoundStatus.BETTING
          ? null
          : this.currentRound.color,
      totalBetsCount: this.currentRound.totalBetsCount,
      totalBetAmount: this.currentRound.totalBetAmount,
      recentWinners: this.lastSettledWinners.slice(0, 5),
    };
  }

  public getCurrentRoundBets(userId?: string) {
    if (!userId) {
      // Return public recent bets (last 20)
      return Array.from(this.currentBets.values())
        .slice(-20)
        .map((b) => ({
          id: b.id,
          username: b.username,
          type: b.type,
          numbers: b.numbers,
          amount: b.amount,
        }));
    }

    // Return specific user's bets for this round
    const betIds = this.userBetsMap.get(userId) || [];
    return betIds.map((id) => this.currentBets.get(id)).filter(Boolean) as RouletteRoundBet[];
  }
}

export const rouletteEngine = new RouletteEngine();
