import {
  TransactionType,
  UserRole,
  DragonTigerRoundStatus,
  DragonTigerRound,
  DragonTigerRoundBet,
  DragonTigerHistoryItem,
} from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';
import {
  Card,
  createDeck,
  shuffleDeck,
} from '../../../../shared/src/utils/teenPatti';

export interface DragonTigerBetInput {
  type: 'dragon' | 'tiger' | 'tie';
  amount: string;
}

export type DragonTigerEventListener = (event: string, data: any) => void;

export class DragonTigerEngine {
  private currentRound: DragonTigerRound;
  private currentBets: Map<string, DragonTigerRoundBet> = new Map();
  private userBetsMap: Map<string, string[]> = new Map();
  private history: DragonTigerHistoryItem[] = [];
  private listeners: Set<DragonTigerEventListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private roundCount = 0;

  private BETTING_DURATION_MS = 12000;  // 12 seconds betting phase
  private REVEAL_DURATION_MS = 4500;   // 4.5 seconds card reveal & clash
  private RESULT_DURATION_MS = 5500;   // 5.5 seconds celebration & roadmap display

  private dragonCard: Card | null = null;
  private tigerCard: Card | null = null;
  private roundWinner: 'dragon' | 'tiger' | 'tie' | null = null;

  constructor() {
    // History starts empty; never display fabricated rounds or community activity.

    this.currentRound = {
      id: `round-dt-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: DragonTigerRoundStatus.BETTING,
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      dragonCard: null,
      tigerCard: null,
      winner: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
      dragonBetAmount: '0',
      tigerBetAmount: '0',
      tieBetAmount: '0',
    };

    // Boot continuous round loop
    this.startBettingPhase();
  }

  public subscribe(listener: DragonTigerEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: string, data: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        // Ignore listener errors
      }
    }
  }

  public getPublicRoundState(): DragonTigerRound {
    return { ...this.currentRound };
  }

  public getCurrentRoundBets(): DragonTigerRoundBet[] {
    return Array.from(this.currentBets.values());
  }

  public getHistory(): DragonTigerHistoryItem[] {
    return [...this.history];
  }

  // --- 1. BETTING PHASE ---
  private startBettingPhase() {
    if (this.timer) clearTimeout(this.timer);

    this.roundCount++;
    this.currentBets.clear();
    this.userBetsMap.clear();

    // Deal 2 fresh random cards (Dragon and Tiger) from shuffled deck
    const deck = shuffleDeck(createDeck());
    this.dragonCard = deck[0];
    this.tigerCard = deck[1];

    // Evaluate winner
    // In Dragon Tiger:
    // Rank 14 is Ace (in standard cards A=14, but in Dragon Tiger A is lowest = 1).
    // Let's normalize Ace rank to 1:
    const dVal = this.dragonCard.rank === 14 ? 1 : this.dragonCard.rank;
    const tVal = this.tigerCard.rank === 14 ? 1 : this.tigerCard.rank;

    if (dVal > tVal) {
      this.roundWinner = 'dragon';
    } else if (tVal > dVal) {
      this.roundWinner = 'tiger';
    } else {
      this.roundWinner = 'tie';
    }

    this.currentRound = {
      id: `round-dt-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: DragonTigerRoundStatus.BETTING,
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      dragonCard: null, // Hidden until reveal
      tigerCard: null,
      winner: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
      dragonBetAmount: '0',
      tigerBetAmount: '0',
      tieBetAmount: '0',
    };

    this.emit('dragon_tiger:round_betting', {
      round: this.getPublicRoundState(),
      history: this.getHistory(),
    });

    // Schedule transition to REVEALING
    this.timer = setTimeout(() => {
      this.startRevealingPhase();
    }, this.BETTING_DURATION_MS);
  }

  // --- 2. REVEALING PHASE ---
  private startRevealingPhase() {
    if (this.timer) clearTimeout(this.timer);

    this.currentRound.status = DragonTigerRoundStatus.REVEALING;
    this.currentRound.dragonCard = this.dragonCard;
    this.currentRound.tigerCard = this.tigerCard;

    this.emit('dragon_tiger:round_revealing', {
      round: this.getPublicRoundState(),
      dragonCard: this.dragonCard,
      tigerCard: this.tigerCard,
    });

    // Pause for 3D flip card animations and clash suspense
    this.timer = setTimeout(() => {
      this.startResultPhase();
    }, this.REVEAL_DURATION_MS);
  }

  // --- 3. RESULT & SETTLEMENT PHASE ---
  private startResultPhase() {
    if (this.timer) clearTimeout(this.timer);

    this.currentRound.status = DragonTigerRoundStatus.RESULT;
    this.currentRound.winner = this.roundWinner;

    const winners: any[] = [];
    const poolWallet = db.getWallet(SYSTEM_WALLETS.DRAGON_TIGER_POOL);

    for (const bet of this.currentBets.values()) {
      let won = false;
      let multiplier = 0;

      // 1. Dragon Bet (1:1 payout)
      if (bet.type === 'dragon' && this.roundWinner === 'dragon') {
        won = true;
        multiplier = 2.0;
      }
      // 2. Tiger Bet (1:1 payout)
      else if (bet.type === 'tiger' && this.roundWinner === 'tiger') {
        won = true;
        multiplier = 2.0;
      }
      // Tie is determined only by equal card rank; suit never creates a separate market.
      else if (bet.type === 'tie' && this.roundWinner === 'tie') {
        won = true;
        multiplier = 9.0;
      }

      bet.won = won;

      if (won) {
        const betAmountNum = parseInt(bet.amount, 10);
        const payoutNum = Math.floor(betAmountNum * multiplier);
        const profitNum = payoutNum - betAmountNum;
        bet.payout = payoutNum.toString();
        bet.profit = profitNum.toString();

        winners.push({
          username: bet.username,
          userId: bet.userId,
          type: bet.type,
          amount: bet.amount,
          payout: bet.payout,
        });

        // Atomic payout from DRAGON_TIGER_POOL to human player wallet
        if (!bet.userId.startsWith('sim-')) {
          const userWallet = db.getWalletByUserId(bet.userId);
          if (userWallet && poolWallet) {
            try {
              db.executeTransfer({
                sourceWalletId: SYSTEM_WALLETS.DRAGON_TIGER_POOL,
                targetWalletId: userWallet.id,
                amount: payoutNum.toString(),
                type: TransactionType.BET_WIN_PAYOUT,
                idempotencyKey: `dt-win-${bet.id}-${Date.now()}`,
                description: `Dragon Tiger Win - Round #${this.currentRound.roundNumber} on ${bet.type.toUpperCase()}`,
                metadata: { roundNumber: this.currentRound.roundNumber, betType: bet.type, multiplier },
              });
            } catch (err: any) {
              console.error('Dragon Tiger win transfer error:', err);
            }
          }
        }
      } else {
        bet.payout = '0';
        bet.profit = `-${bet.amount}`;
      }
    }

    // Add to History
    this.history.unshift({
      roundNumber: this.currentRound.roundNumber,
      dragonCard: this.dragonCard!,
      tigerCard: this.tigerCard!,
      winner: this.roundWinner!,
      timestamp: new Date().toISOString(),
    });
    if (this.history.length > 20) this.history.pop();

    this.emit('dragon_tiger:round_result', {
      round: this.getPublicRoundState(),
      winners,
      history: this.getHistory(),
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
    bets: DragonTigerBetInput[];
  }) {
    if (this.currentRound.status !== DragonTigerRoundStatus.BETTING) {
      throw new Error('Betting is closed for this round. Please wait for the next round.');
    }

    const userWallet = db.getWalletByUserId(params.userId);
    if (!userWallet) throw new Error('User wallet not found');

    let totalRequested = 0n;
    if (params.userRole !== UserRole.PLAYER) throw new Error('PLAYER_ROLE_REQUIRED');
    if (!Array.isArray(params.bets) || params.bets.length < 1 || params.bets.length > 20) throw new Error('INVALID_BET_COUNT');
    for (const b of params.bets) {
      if (!['dragon', 'tiger', 'tie'].includes(String(b.type).toLowerCase())) throw new Error('UNSUPPORTED_DRAGON_TIGER_MARKET');
      if (!/^\d+$/.test(b.amount)) throw new Error('INVALID_BET_AMOUNT');
      const amt = BigInt(b.amount);
      if (amt < 10n || amt > 100000n) throw new Error('BET_OUT_OF_RANGE');
      totalRequested += amt;
    }

    if (BigInt(userWallet.balance) < totalRequested) {
      throw new Error('Insufficient wallet balance to place bets');
    }

    // Deduct total bet atomically into DRAGON_TIGER_POOL
    db.executeTransfer({
      sourceWalletId: userWallet.id,
      targetWalletId: SYSTEM_WALLETS.DRAGON_TIGER_POOL,
      amount: totalRequested.toString(),
      type: TransactionType.BET_ESCROW_LOCK,
      idempotencyKey: `dt-bet-${params.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      description: `Dragon Tiger Bet - Round #${this.currentRound.roundNumber}`,
      metadata: { roundNumber: this.currentRound.roundNumber, betsCount: params.bets.length },
    });

    const createdBets: DragonTigerRoundBet[] = [];
    for (const b of params.bets) {
      const betId = `dt-bet-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const roundBet: DragonTigerRoundBet = {
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

      if (b.type === 'dragon') {
        this.currentRound.dragonBetAmount = (
          BigInt(this.currentRound.dragonBetAmount) + BigInt(b.amount)
        ).toString();
      } else if (b.type === 'tiger') {
        this.currentRound.tigerBetAmount = (
          BigInt(this.currentRound.tigerBetAmount) + BigInt(b.amount)
        ).toString();
      } else if (b.type === 'tie') {
        this.currentRound.tieBetAmount = (
          BigInt(this.currentRound.tieBetAmount) + BigInt(b.amount)
        ).toString();
      }

      const existing = this.userBetsMap.get(params.userId) || [];
      existing.push(betId);
      this.userBetsMap.set(params.userId, existing);
    }

    this.emit('dragon_tiger:bet_placed', {
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

}

export const dragonTigerEngine = new DragonTigerEngine();
