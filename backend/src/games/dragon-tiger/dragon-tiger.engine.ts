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
  type: string; // 'dragon' | 'tiger' | 'tie' | 'suited_tie' | 'dragon_big' | 'dragon_small' | 'tiger_big' | 'tiger_small'
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
  private simBetTimeouts: NodeJS.Timeout[] = [];
  private roundCount = 501;

  private BETTING_DURATION_MS = 12000;  // 12 seconds betting phase
  private REVEAL_DURATION_MS = 4500;   // 4.5 seconds card reveal & clash
  private RESULT_DURATION_MS = 5500;   // 5.5 seconds celebration & roadmap display

  private dragonCard: Card | null = null;
  private tigerCard: Card | null = null;
  private roundWinner: 'dragon' | 'tiger' | 'tie' | 'suited_tie' | null = null;

  constructor() {
    // Seed initial realistic roadmap history
    const seed = [
      { d: { rank: 13, suit: 'H' as const }, t: { rank: 9, suit: 'S' as const }, w: 'dragon' as const },
      { d: { rank: 4, suit: 'D' as const }, t: { rank: 11, suit: 'C' as const }, w: 'tiger' as const },
      { d: { rank: 8, suit: 'S' as const }, t: { rank: 8, suit: 'H' as const }, w: 'tie' as const },
      { d: { rank: 14, suit: 'C' as const }, t: { rank: 12, suit: 'D' as const }, w: 'dragon' as const },
      { d: { rank: 2, suit: 'H' as const }, t: { rank: 7, suit: 'S' as const }, w: 'tiger' as const },
      { d: { rank: 10, suit: 'D' as const }, t: { rank: 5, suit: 'C' as const }, w: 'dragon' as const },
    ];

    this.history = seed.map((item, idx) => ({
      roundNumber: this.roundCount - seed.length + idx,
      dragonCard: item.d,
      tigerCard: item.t,
      winner: item.w,
      timestamp: new Date(Date.now() - (seed.length - idx) * 30000).toISOString(),
    }));

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
    this.simBetTimeouts.forEach((t) => clearTimeout(t));
    this.simBetTimeouts = [];

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
      this.roundWinner = this.dragonCard.suit === this.tigerCard.suit ? 'suited_tie' : 'tie';
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

    // Schedule active online simulated bets from community
    this.scheduleSimulatedCommunityBets();

    // Schedule transition to REVEALING
    this.timer = setTimeout(() => {
      this.startRevealingPhase();
    }, this.BETTING_DURATION_MS);
  }

  // --- 2. REVEALING PHASE ---
  private startRevealingPhase() {
    if (this.timer) clearTimeout(this.timer);
    this.simBetTimeouts.forEach((t) => clearTimeout(t));

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

    const dVal = this.dragonCard!.rank === 14 ? 1 : this.dragonCard!.rank;
    const tVal = this.tigerCard!.rank === 14 ? 1 : this.tigerCard!.rank;

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
      // 3. Tie Bet (8:1 or 9x total return)
      else if (bet.type === 'tie' && (this.roundWinner === 'tie' || this.roundWinner === 'suited_tie')) {
        won = true;
        multiplier = 9.0;
      }
      // 4. Suited Tie Bet (50:1 or 51x total return)
      else if (bet.type === 'suited_tie' && this.roundWinner === 'suited_tie') {
        won = true;
        multiplier = 51.0;
      }
      // 5. Side Bets: Big (8-13), Small (1-6)
      else if (bet.type === 'dragon_big' && dVal >= 8 && dVal !== 7) {
        won = true;
        multiplier = 2.0;
      } else if (bet.type === 'dragon_small' && dVal <= 6) {
        won = true;
        multiplier = 2.0;
      } else if (bet.type === 'tiger_big' && tVal >= 8 && tVal !== 7) {
        won = true;
        multiplier = 2.0;
      } else if (bet.type === 'tiger_small' && tVal <= 6) {
        won = true;
        multiplier = 2.0;
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
    for (const b of params.bets) {
      const amt = BigInt(b.amount);
      if (amt <= 0n) throw new Error('Bet amount must be greater than 0');
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
      } else if (b.type === 'tie' || b.type === 'suited_tie') {
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

  // Simulated community bets
  private scheduleSimulatedCommunityBets() {
    const simUsers = ['vegas_raj', 'anita_k', 'surya_strike', 'divya_77', 'rahul_ace'];
    const delays = [1200, 3000, 5500, 8000, 10000];

    delays.forEach((delay, idx) => {
      const t = setTimeout(() => {
        if (this.currentRound.status !== DragonTigerRoundStatus.BETTING) return;
        const u = simUsers[idx % simUsers.length];
        const sides = ['dragon', 'tiger', 'dragon', 'tiger', 'tie'];
        const side = sides[Math.floor(Math.random() * sides.length)];
        const amount = [50, 100, 200, 500][Math.floor(Math.random() * 4)].toString();

        const simBetId = `sim-dt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const roundBet: DragonTigerRoundBet = {
          id: simBetId,
          roundId: this.currentRound.id,
          userId: `sim-${u}`,
          username: u,
          type: side,
          amount,
          createdAt: new Date().toISOString(),
        };

        this.currentBets.set(simBetId, roundBet);
        this.currentRound.totalBetsCount++;
        this.currentRound.totalBetAmount = (
          BigInt(this.currentRound.totalBetAmount) + BigInt(amount)
        ).toString();

        if (side === 'dragon') {
          this.currentRound.dragonBetAmount = (
            BigInt(this.currentRound.dragonBetAmount) + BigInt(amount)
          ).toString();
        } else if (side === 'tiger') {
          this.currentRound.tigerBetAmount = (
            BigInt(this.currentRound.tigerBetAmount) + BigInt(amount)
          ).toString();
        } else {
          this.currentRound.tieBetAmount = (
            BigInt(this.currentRound.tieBetAmount) + BigInt(amount)
          ).toString();
        }

        this.emit('dragon_tiger:bet_placed', {
          roundId: this.currentRound.id,
          bets: [roundBet],
          round: this.getPublicRoundState(),
        });
      }, delay);

      this.simBetTimeouts.push(t);
    });
  }
}

export const dragonTigerEngine = new DragonTigerEngine();
