import {
  TransactionType,
  UserRole,
  AndarBaharRoundStatus,
  AndarBaharRound,
  AndarBaharRoundBet,
  AndarBaharHistoryItem,
} from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';
import {
  Card,
  createDeck,
  shuffleDeck,
  SUIT_COLORS,
} from '../../../../shared/src/utils/teenPatti';

export interface AndarBaharBetInput {
  type: string; // 'andar' | 'bahar' | 'joker_red' | 'joker_black' | 'cards_1_5' | 'cards_6_10' | 'cards_11_15' | 'cards_16_25' | 'cards_25_plus'
  amount: string;
}

export type AndarBaharEventListener = (event: string, data: any) => void;

export class AndarBaharEngine {
  private currentRound: AndarBaharRound;
  private currentBets: Map<string, AndarBaharRoundBet> = new Map();
  private userBetsMap: Map<string, string[]> = new Map();
  private history: AndarBaharHistoryItem[] = [];
  private listeners: Set<AndarBaharEventListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private dealTimer: NodeJS.Timeout | null = null;
  private simBetTimeouts: NodeJS.Timeout[] = [];
  private roundCount = 301;

  private BETTING_DURATION_MS = 13000; // 13 seconds betting phase
  private RESULT_DURATION_MS = 6000;   // 6 seconds result showcase
  private DEAL_SPEED_MS = 650;        // 650ms per card deal animation

  // Active dealing deck & pre-calculated deal steps for the round
  private remainingDeck: Card[] = [];
  private fullDealQueue: Array<{ side: 'andar' | 'bahar'; card: Card }> = [];
  private winningCard: Card | null = null;
  private winningSide: 'andar' | 'bahar' | null = null;

  constructor() {
    // Seed initial realistic history
    const seedRanks = [
      { r: 8, s: 'H' as const, win: 'andar' as const, winR: 8, winS: 'S' as const, count: 5 },
      { r: 13, s: 'S' as const, win: 'bahar' as const, winR: 13, winS: 'C' as const, count: 8 },
      { r: 2, s: 'D' as const, win: 'andar' as const, winR: 2, winS: 'H' as const, count: 3 },
      { r: 10, s: 'C' as const, win: 'andar' as const, winR: 10, winS: 'D' as const, count: 11 },
      { r: 14, s: 'H' as const, win: 'bahar' as const, winR: 14, winS: 'S' as const, count: 4 },
      { r: 7, s: 'S' as const, win: 'bahar' as const, winR: 7, winS: 'C' as const, count: 9 },
    ];

    this.history = seedRanks.map((item, idx) => ({
      roundNumber: this.roundCount - seedRanks.length + idx,
      jokerCard: { suit: item.s, rank: item.r },
      winningSide: item.win,
      winningCard: { suit: item.winS, rank: item.winR },
      totalCards: item.count,
      timestamp: new Date(Date.now() - (seedRanks.length - idx) * 35000).toISOString(),
    }));

    // Start with blank round structure
    this.currentRound = {
      id: `round-ab-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: AndarBaharRoundStatus.BETTING,
      jokerCard: { suit: 'H', rank: 8 },
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      dealCards: [],
      winningSide: null,
      winningCard: null,
      totalCardsDealt: 0,
      firstSide: 'bahar',
      totalBetsCount: 0,
      totalBetAmount: '0',
      andarBetAmount: '0',
      baharBetAmount: '0',
    };

    // Boot continuous round ticker
    this.startBettingPhase();
  }

  public subscribe(listener: AndarBaharEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: string, data: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  public getPublicRoundState(): AndarBaharRound {
    return { ...this.currentRound };
  }

  public getCurrentRoundBets(): AndarBaharRoundBet[] {
    return Array.from(this.currentBets.values());
  }

  public getHistory(): AndarBaharHistoryItem[] {
    return [...this.history];
  }

  // --- 1. BETTING PHASE ---
  private startBettingPhase() {
    if (this.timer) clearTimeout(this.timer);
    if (this.dealTimer) clearInterval(this.dealTimer);
    this.simBetTimeouts.forEach((t) => clearTimeout(t));
    this.simBetTimeouts = [];

    this.roundCount++;
    this.currentBets.clear();
    this.userBetsMap.clear();

    // Shuffle full 52-card deck
    const deck = shuffleDeck(createDeck());
    const jokerCard = deck[0];
    this.remainingDeck = deck.slice(1);

    // Official Andar Bahar Rule:
    // If Joker is Black (Spades or Clubs), 1st card goes to ANDAR.
    // If Joker is Red (Hearts or Diamonds), 1st card goes to BAHAR.
    const isBlack = SUIT_COLORS[jokerCard.suit] === 'black';
    const firstSide: 'andar' | 'bahar' = isBlack ? 'andar' : 'bahar';

    // Pre-calculate full sequence of cards until rank matches Joker
    this.fullDealQueue = [];
    let currentSide = firstSide;
    let winnerFound = false;

    for (const card of this.remainingDeck) {
      this.fullDealQueue.push({ side: currentSide, card });
      if (card.rank === jokerCard.rank) {
        this.winningSide = currentSide;
        this.winningCard = card;
        winnerFound = true;
        break;
      }
      currentSide = currentSide === 'andar' ? 'bahar' : 'andar';
    }

    // Safety fallback (should never trigger since standard deck has 3 matching ranks)
    if (!winnerFound) {
      this.winningSide = 'andar';
      this.winningCard = { suit: 'S', rank: jokerCard.rank };
      this.fullDealQueue.push({ side: 'andar', card: this.winningCard });
    }

    this.currentRound = {
      id: `round-ab-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: AndarBaharRoundStatus.BETTING,
      jokerCard,
      bettingEndsAt: Date.now() + this.BETTING_DURATION_MS,
      dealCards: [],
      winningSide: null,
      winningCard: null,
      totalCardsDealt: 0,
      firstSide,
      totalBetsCount: 0,
      totalBetAmount: '0',
      andarBetAmount: '0',
      baharBetAmount: '0',
    };

    this.emit('andar_bahar:round_betting', {
      round: this.getPublicRoundState(),
      history: this.getHistory(),
    });

    // Schedule community simulated bets
    this.scheduleSimulatedCommunityBets();

    // Schedule transition to DEALING
    this.timer = setTimeout(() => {
      this.startDealingPhase();
    }, this.BETTING_DURATION_MS);
  }

  // --- 2. DEALING PHASE ---
  private startDealingPhase() {
    if (this.timer) clearTimeout(this.timer);
    this.simBetTimeouts.forEach((t) => clearTimeout(t));

    this.currentRound.status = AndarBaharRoundStatus.DEALING;
    this.currentRound.dealCards = [];

    this.emit('andar_bahar:round_dealing', {
      round: this.getPublicRoundState(),
    });

    // Deal cards sequentially alternating sides
    let dealIndex = 0;
    const totalToDeal = this.fullDealQueue.length;

    this.dealTimer = setInterval(() => {
      if (dealIndex >= totalToDeal) {
        if (this.dealTimer) clearInterval(this.dealTimer);
        this.startResultPhase();
        return;
      }

      const nextCardItem = this.fullDealQueue[dealIndex];
      this.currentRound.dealCards.push(nextCardItem);
      this.currentRound.totalCardsDealt = this.currentRound.dealCards.length;

      const isMatch = nextCardItem.card.rank === this.currentRound.jokerCard!.rank;

      this.emit('andar_bahar:card_dealt', {
        roundId: this.currentRound.id,
        item: nextCardItem,
        totalDealt: this.currentRound.totalCardsDealt,
        isMatch,
      });

      if (isMatch) {
        if (this.dealTimer) clearInterval(this.dealTimer);
        // Pause briefly on winning card then announce result
        this.timer = setTimeout(() => {
          this.startResultPhase();
        }, 1200);
      }

      dealIndex++;
    }, this.DEAL_SPEED_MS);
  }

  // --- 3. RESULT & SETTLEMENT PHASE ---
  private startResultPhase() {
    if (this.dealTimer) clearInterval(this.dealTimer);
    if (this.timer) clearTimeout(this.timer);

    this.currentRound.status = AndarBaharRoundStatus.RESULT;
    this.currentRound.winningSide = this.winningSide;
    this.currentRound.winningCard = this.winningCard;

    // Process all bets and compute payouts
    const winners: any[] = [];
    const poolWallet = db.getWallet(SYSTEM_WALLETS.ANDAR_BAHAR_POOL);

    for (const bet of this.currentBets.values()) {
      let won = false;
      let multiplier = 0;

      // 1. Primary Andar / Bahar Bet
      if (bet.type === this.winningSide) {
        won = true;
        // Standard Andar Bahar odds:
        // First card side pays 1.9x (or 1.95x). Second card side pays 2.0x.
        multiplier = this.winningSide === this.currentRound.firstSide ? 1.9 : 2.0;
      }
      // 2. Joker Color Side Bets
      else if (bet.type === 'joker_red' && SUIT_COLORS[this.currentRound.jokerCard!.suit] === 'red') {
        won = true;
        multiplier = 1.95;
      } else if (bet.type === 'joker_black' && SUIT_COLORS[this.currentRound.jokerCard!.suit] === 'black') {
        won = true;
        multiplier = 1.95;
      }
      // 3. Total Cards Dealt Range Side Bets
      else if (bet.type === 'cards_1_5' && this.currentRound.totalCardsDealt <= 5) {
        won = true;
        multiplier = 3.5;
      } else if (bet.type === 'cards_6_10' && this.currentRound.totalCardsDealt >= 6 && this.currentRound.totalCardsDealt <= 10) {
        won = true;
        multiplier = 4.5;
      } else if (bet.type === 'cards_11_15' && this.currentRound.totalCardsDealt >= 11 && this.currentRound.totalCardsDealt <= 15) {
        won = true;
        multiplier = 5.5;
      } else if (bet.type === 'cards_16_25' && this.currentRound.totalCardsDealt >= 16 && this.currentRound.totalCardsDealt <= 25) {
        won = true;
        multiplier = 4.5;
      } else if (bet.type === 'cards_25_plus' && this.currentRound.totalCardsDealt > 25) {
        won = true;
        multiplier = 25.0;
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

        // Credit real winnings to user wallet if not a simulated bot
        if (!bet.userId.startsWith('sim-')) {
          const userWallet = db.getWalletByUserId(bet.userId);
          if (userWallet && poolWallet) {
            try {
              db.executeTransfer({
                sourceWalletId: SYSTEM_WALLETS.ANDAR_BAHAR_POOL,
                targetWalletId: userWallet.id,
                amount: payoutNum.toString(),
                type: TransactionType.BET_WIN_PAYOUT,
                idempotencyKey: `ab-win-${bet.id}-${Date.now()}`,
                description: `Andar Bahar Win - Round #${this.currentRound.roundNumber} on ${bet.type.toUpperCase()}`,
                metadata: { roundNumber: this.currentRound.roundNumber, betType: bet.type, multiplier },
              });
            } catch (err: any) {
              console.error('Andar Bahar win transfer error:', err);
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
      jokerCard: this.currentRound.jokerCard!,
      winningSide: this.winningSide!,
      winningCard: this.winningCard!,
      totalCards: this.currentRound.totalCardsDealt,
      timestamp: new Date().toISOString(),
    });
    if (this.history.length > 20) this.history.pop();

    this.emit('andar_bahar:round_result', {
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
    bets: AndarBaharBetInput[];
  }) {
    if (this.currentRound.status !== AndarBaharRoundStatus.BETTING) {
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

    // Deduct total bet atomically into ANDAR_BAHAR_POOL
    db.executeTransfer({
      sourceWalletId: userWallet.id,
      targetWalletId: SYSTEM_WALLETS.ANDAR_BAHAR_POOL,
      amount: totalRequested.toString(),
      type: TransactionType.BET_ESCROW_LOCK,
      idempotencyKey: `ab-bet-${params.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      description: `Andar Bahar Bet - Round #${this.currentRound.roundNumber}`,
      metadata: { roundNumber: this.currentRound.roundNumber, betsCount: params.bets.length },
    });

    // Record individual bets
    const createdBets: AndarBaharRoundBet[] = [];
    for (const b of params.bets) {
      const betId = `ab-bet-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const roundBet: AndarBaharRoundBet = {
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

      // Update round counters
      this.currentRound.totalBetsCount++;
      this.currentRound.totalBetAmount = (
        BigInt(this.currentRound.totalBetAmount) + BigInt(b.amount)
      ).toString();

      if (b.type === 'andar') {
        this.currentRound.andarBetAmount = (
          BigInt(this.currentRound.andarBetAmount) + BigInt(b.amount)
        ).toString();
      } else if (b.type === 'bahar') {
        this.currentRound.baharBetAmount = (
          BigInt(this.currentRound.baharBetAmount) + BigInt(b.amount)
        ).toString();
      }

      // Track by user
      const existing = this.userBetsMap.get(params.userId) || [];
      existing.push(betId);
      this.userBetsMap.set(params.userId, existing);
    }

    // Broadcast community bet placed event
    this.emit('andar_bahar:bet_placed', {
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

  // Simulated bets from online players to make the synchronized table feel live & active
  private scheduleSimulatedCommunityBets() {
    const simUsers = ['karthik_pro', 'arjun_m', 'priya_reddy', 'deepak_99', 'suresh_v'];
    const delays = [1500, 3500, 6000, 8500, 10500];

    delays.forEach((delay, idx) => {
      const t = setTimeout(() => {
        if (this.currentRound.status !== AndarBaharRoundStatus.BETTING) return;
        const u = simUsers[idx % simUsers.length];
        const side = Math.random() < 0.52 ? 'andar' : 'bahar';
        const amount = [50, 100, 250, 500][Math.floor(Math.random() * 4)].toString();

        const simBetId = `sim-ab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const roundBet: AndarBaharRoundBet = {
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

        if (side === 'andar') {
          this.currentRound.andarBetAmount = (
            BigInt(this.currentRound.andarBetAmount) + BigInt(amount)
          ).toString();
        } else {
          this.currentRound.baharBetAmount = (
            BigInt(this.currentRound.baharBetAmount) + BigInt(amount)
          ).toString();
        }

        this.emit('andar_bahar:bet_placed', {
          roundId: this.currentRound.id,
          bets: [roundBet],
          round: this.getPublicRoundState(),
        });
      }, delay);

      this.simBetTimeouts.push(t);
    });
  }
}

export const andarBaharEngine = new AndarBaharEngine();
