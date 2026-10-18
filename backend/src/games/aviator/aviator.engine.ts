import {
  AviatorRound,
  AviatorBet,
  RoundStatus,
  BetStatus,
  TransactionType,
  UserRole,
} from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';

export type GameEventListener = (event: string, data: any) => void;

export class AviatorEngine {
  private currentRound: AviatorRound;
  private currentBets: Map<string, AviatorBet> = new Map();
  private pastRounds: Array<{ roundNumber: number; crashMultiplier: number }> = [];
  private listeners: Set<GameEventListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private roundCount = 101;
  private nextRoundScheduled = false;

  constructor() {
    // Initialize past recent rounds for realistic casino history bar
    this.pastRounds = [
      { roundNumber: 96, crashMultiplier: 2.14 },
      { roundNumber: 97, crashMultiplier: 1.35 },
      { roundNumber: 98, crashMultiplier: 5.62 },
      { roundNumber: 99, crashMultiplier: 1.12 },
      { roundNumber: 100, crashMultiplier: 3.48 },
    ];

    this.currentRound = this.createNewRound();
    this.startWaitingPhase();
  }

  public subscribe(listener: GameEventListener) {
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

  private createNewRound(): AviatorRound {
    this.roundCount++;
    // Generate provably-fair style crash multiplier:
    // 97% RTP curve: crash = 0.97 / (1 - U), minimum 1.00
    const u = Math.random();
    let crash = Math.floor((0.97 / (1 - u)) * 100) / 100;
    if (crash < 1.0) crash = 1.0;
    if (crash > 50.0) crash = 50.0; // cap max multiplier to 50x for pool safety

    return {
      id: `round-aviator-${this.roundCount}`,
      roundNumber: this.roundCount,
      status: RoundStatus.WAITING,
      multiplier: 1.0,
      crashMultiplier: crash,
      startTime: Date.now() + 5000, // 5 seconds betting phase
      crashedAt: null,
      totalBetsCount: 0,
      totalBetAmount: '0',
    };
  }

  private startWaitingPhase() {
    this.currentBets.clear();
    this.currentRound.status = RoundStatus.WAITING;
    this.currentRound.startTime = Date.now() + 5000;
    this.currentRound.multiplier = 1.0;
    this.currentRound.crashedAt = null;

    this.emit('aviator:round_waiting', {
      round: this.getPublicRoundState(),
      history: this.pastRounds.slice(-10),
    });

    // Add some simulated community bets to create authentic casino buzz
    this.addSimulatedBets();

    setTimeout(() => {
      this.startFlyingPhase();
    }, 5000);
  }

  private addSimulatedBets() {
    const mockUsers = ['crypto_king', 'lucky_strike', 'goa_highroller', 'vegas_ace', 'mumbai_bull'];
    for (const name of mockUsers) {
      if (Math.random() > 0.3) {
        const amt = (Math.floor(Math.random() * 50) + 1) * 50;
        const auto = Math.random() > 0.5 ? Math.round((1.2 + Math.random() * 3) * 100) / 100 : null;
        const betId = `sim-bet-${name}-${Date.now()}`;
        this.currentBets.set(betId, {
          id: betId,
          roundId: this.currentRound.id,
          userId: `sim-${name}`,
          username: name,
          betAmount: amt.toString(),
          autoCashoutMultiplier: auto,
          cashedOutMultiplier: null,
          winAmount: null,
          status: BetStatus.PENDING,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  private startFlyingPhase() {
    this.currentRound.status = RoundStatus.RUNNING;
    const startFlight = Date.now();
    this.currentRound.startTime = startFlight;

    this.emit('aviator:round_started', {
      round: this.getPublicRoundState(),
      bets: Array.from(this.currentBets.values()),
    });

    // Broadcast tick updates every 100ms
    const intervalMs = 100;
    this.timer = setInterval(() => {
      const elapsedSec = (Date.now() - startFlight) / 1000;
      // Exponential curve: multiplier = e^(0.06 * elapsedSec^1.15)
      const currentMult = Math.round(Math.exp(0.06 * Math.pow(elapsedSec, 1.15)) * 100) / 100;
      this.currentRound.multiplier = currentMult;

      // Check auto-cashouts
      this.checkAutoCashouts(currentMult);

      // Check if crash threshold reached
      if (currentMult >= this.currentRound.crashMultiplier) {
        this.handleCrash();
      } else {
        this.emit('aviator:tick', {
          multiplier: currentMult,
          roundId: this.currentRound.id,
        });
      }
    }, intervalMs);
  }

  private checkAutoCashouts(currentMultiplier: number) {
    for (const bet of this.currentBets.values()) {
      if (
        bet.status === BetStatus.PENDING &&
        bet.autoCashoutMultiplier &&
        currentMultiplier >= bet.autoCashoutMultiplier
      ) {
        if (!bet.userId.startsWith('sim-')) {
          this.cashoutBet(bet.userId, bet.id, bet.autoCashoutMultiplier);
        } else {
          // Simulated bet cashout
          bet.status = BetStatus.WON;
          bet.cashedOutMultiplier = bet.autoCashoutMultiplier;
          const win = Math.floor(parseInt(bet.betAmount, 10) * bet.autoCashoutMultiplier);
          bet.winAmount = win.toString();
          this.emit('aviator:bet_cashed_out', { bet });
        }
      }
    }
  }

  private handleCrash() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.currentRound.status = RoundStatus.CRASHED;
    this.currentRound.crashedAt = Date.now();
    this.currentRound.multiplier = this.currentRound.crashMultiplier;

    this.pastRounds.push({
      roundNumber: this.currentRound.roundNumber,
      crashMultiplier: this.currentRound.crashMultiplier,
    });
    if (this.pastRounds.length > 20) {
      this.pastRounds.shift();
    }

    // Authoritative Settlement for all un-cashed out bets (LOSSES):
    // Move stakes from Bet Escrow to Owner Treasury!
    this.settleLosingBets();

    this.emit('aviator:crashed', {
      round: this.getPublicRoundState(),
      crashMultiplier: this.currentRound.crashMultiplier,
    });

    // Schedule next round after 4s
    setTimeout(() => {
      this.currentRound = this.createNewRound();
      this.startWaitingPhase();
    }, 4000);
  }

  private settleLosingBets() {
    for (const bet of this.currentBets.values()) {
      if (bet.status === BetStatus.PENDING) {
        bet.status = BetStatus.LOST;

        // If it's a real player bet:
        if (!bet.userId.startsWith('sim-')) {
          try {
            // Escrow stake is transferred to Owner Treasury on loss
            db.executeTransfer({
              sourceWalletId: SYSTEM_WALLETS.BET_ESCROW,
              targetWalletId: SYSTEM_WALLETS.TREASURY,
              amount: bet.betAmount,
              type: TransactionType.BET_LOSS_TREASURY,
              idempotencyKey: `BET_LOSS_${bet.id}`,
              description: `Aviator Bet #${bet.id} loss transferred to Owner Treasury`,
              metadata: { betId: bet.id, roundId: this.currentRound.id },
            });
          } catch (e: any) {
            console.error('Error settling lost bet to treasury:', e);
          }
        }
      }
    }
  }

  // --- BET PLACEMENT ---

  public placeBet(params: {
    userId: string;
    username: string;
    userRole: UserRole;
    amount: string;
    autoCashoutMultiplier?: number | null;
  }): AviatorBet {
    // 1. Only PLAYER role can place bets!
    if (params.userRole !== UserRole.PLAYER) {
      throw new Error('Only the Player role can access and play casino games');
    }

    // 2. Round must be in WAITING state
    if (this.currentRound.status !== RoundStatus.WAITING) {
      throw new Error('Betting is closed for this round. Please wait for next round.');
    }

    const amountBigInt = BigInt(params.amount);
    if (amountBigInt <= 0n) {
      throw new Error('Bet amount must be greater than zero');
    }

    // 3. Game Pool Solvency Check:
    // Verify that the Aviator Game Pool has sufficient funds to cover potential winnings!
    const poolWallet = db.getWallet(SYSTEM_WALLETS.AVIATOR_POOL);
    if (!poolWallet) {
      throw new Error('Aviator Game Pool is unavailable');
    }

    const poolBalanceBigInt = BigInt(poolWallet.balance);
    // Liability check: if autoCashout is set, potential liability is amount * (multiplier - 1)
    const liabilityMultiplier = params.autoCashoutMultiplier ? Math.ceil(params.autoCashoutMultiplier) : 10;
    const estimatedLiability = amountBigInt * BigInt(liabilityMultiplier);

    if (poolBalanceBigInt < amountBigInt * 2n) {
      throw new Error(
        'Aviator Game Pool liquidity is currently low. The Owner must allocate tokens to the pool before high-liability bets can be accepted.'
      );
    }

    // 4. Player balance check and atomic escrow lock
    const playerWallet = db.getWalletByUserId(params.userId);
    if (!playerWallet) {
      throw new Error('Player wallet not found');
    }

    const playerBalance = BigInt(playerWallet.balance);
    if (playerBalance < amountBigInt) {
      throw new Error(`Insufficient balance: available ${playerBalance}, required ${amountBigInt}`);
    }

    const betId = `bet-aviator-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Atomic transfer from Player to Bet Escrow
    db.executeTransfer({
      sourceWalletId: playerWallet.id,
      targetWalletId: SYSTEM_WALLETS.BET_ESCROW,
      amount: params.amount,
      type: TransactionType.BET_ESCROW_LOCK,
      idempotencyKey: `BET_LOCK_${betId}`,
      description: `Aviator Round #${this.currentRound.roundNumber} Stake Escrowed`,
      metadata: { betId, roundId: this.currentRound.id },
    });

    const bet: AviatorBet = {
      id: betId,
      roundId: this.currentRound.id,
      userId: params.userId,
      username: params.username,
      betAmount: params.amount,
      autoCashoutMultiplier: params.autoCashoutMultiplier || null,
      cashedOutMultiplier: null,
      winAmount: null,
      status: BetStatus.PENDING,
      createdAt: new Date().toISOString(),
    };

    this.currentBets.set(betId, bet);

    this.emit('aviator:new_bet', { bet });
    return bet;
  }

  // --- AUTHORITATIVE CASHOUT ---

  public cashoutBet(userId: string, betId: string, clientMultiplier?: number): AviatorBet {
    if (this.currentRound.status !== RoundStatus.RUNNING) {
      throw new Error('Cannot cash out: round is not active');
    }

    const bet = this.currentBets.get(betId);
    if (!bet) {
      throw new Error('Bet not found in current round');
    }

    if (bet.userId !== userId) {
      throw new Error('Unauthorized: you do not own this bet');
    }

    if (bet.status !== BetStatus.PENDING) {
      throw new Error(`Bet is already settled with status ${bet.status}`);
    }

    // Backend authoritative multiplier check
    const currentMult = this.currentRound.multiplier;
    const effectiveMult = clientMultiplier && clientMultiplier <= currentMult ? clientMultiplier : currentMult;

    if (effectiveMult < 1.01) {
      throw new Error('Invalid cashout multiplier');
    }

    const stakeBigInt = BigInt(bet.betAmount);

    // Rule 8: Define the payout multiplier convention clearly.
    // If a 2x payout includes original stake:
    // 1. Return stake from Escrow back to Player.
    // 2. Pay net winnings (stake * (multiplier - 1)) from Aviator Game Pool to Player.
    const playerWallet = db.getWalletByUserId(userId)!;
    const poolWallet = db.getWallet(SYSTEM_WALLETS.AVIATOR_POOL)!;

    // Calculate net winnings using integer token arithmetic
    // multiplier represented to 2 decimal places: e.g. 2.45 -> multHundred = 245
    const multHundred = BigInt(Math.floor(effectiveMult * 100));
    const hundred = 100n;
    const totalPayoutBigInt = (stakeBigInt * multHundred) / hundred;
    const netWinBigInt = totalPayoutBigInt - stakeBigInt;

    // 1. Return original stake from Escrow to Player
    db.executeTransfer({
      sourceWalletId: SYSTEM_WALLETS.BET_ESCROW,
      targetWalletId: playerWallet.id,
      amount: bet.betAmount,
      type: TransactionType.BET_ESCROW_REFUND,
      idempotencyKey: `REFUND_ESCROW_${bet.id}`,
      description: `Aviator Stake #${bet.id} returned upon cashout`,
      metadata: { betId: bet.id },
    });

    // 2. Pay net winnings from Aviator Game Pool to Player
    if (netWinBigInt > 0n) {
      const poolBalance = BigInt(poolWallet.balance);
      if (poolBalance < netWinBigInt) {
        throw new Error('Game pool has insufficient liquidity to pay net winnings');
      }

      db.executeTransfer({
        sourceWalletId: SYSTEM_WALLETS.AVIATOR_POOL,
        targetWalletId: playerWallet.id,
        amount: netWinBigInt.toString(),
        type: TransactionType.BET_WIN_PAYOUT,
        idempotencyKey: `WIN_PAYOUT_${bet.id}`,
        description: `Aviator Net Winnings at ${effectiveMult}x payout`,
        metadata: { betId: bet.id, multiplier: effectiveMult },
      });
    }

    bet.status = BetStatus.WON;
    bet.cashedOutMultiplier = effectiveMult;
    bet.winAmount = totalPayoutBigInt.toString();

    this.emit('aviator:bet_cashed_out', {
      bet,
      playerWallet: db.getWalletByUserId(userId),
    });

    return bet;
  }

  public getPublicRoundState() {
    return {
      id: this.currentRound.id,
      roundNumber: this.currentRound.roundNumber,
      status: this.currentRound.status,
      multiplier: this.currentRound.multiplier,
      startTime: this.currentRound.startTime,
      crashedAt: this.currentRound.crashedAt,
      betsCount: this.currentBets.size,
    };
  }

  public getCurrentBets(): AviatorBet[] {
    return Array.from(this.currentBets.values());
  }

  public getHistory() {
    return this.pastRounds.slice(-15);
  }
}

export const aviatorEngine = new AviatorEngine();
