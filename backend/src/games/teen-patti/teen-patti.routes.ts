import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { db } from '../../db/storage';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { TransactionType } from '../../../../shared/src/types';
import {
  Card,
  createDeck,
  shuffleDeck,
  evaluateTeenPattiHand,
  compareHands,
} from '../../../../shared/src/utils/teenPatti';

export const teenPattiRouter = Router();

interface TeenPattiPlayer {
  id: string;
  name: string;
  isAi: boolean;
  cards: Card[];
  isSeen: boolean;
  hasFolded: boolean;
  totalBet: number;
}

interface ActiveTable {
  roundId: string;
  roundNumber: number;
  bootAmount: number;
  currentStake: number;
  pot: number;
  status: 'BETTING' | 'SHOWDOWN' | 'SETTLED';
  players: TeenPattiPlayer[];
  winnerId: string | null;
  winnerHand: string | null;
  winAmount: number;
}

// In-memory active tables mapped by player userId
const activeTables: Map<string, ActiveTable> = new Map();
let globalRoundCounter = 101;

// GET /api/games/teen-patti/state
teenPattiRouter.get('/state', (req, res: Response) => {
  const poolWallet = db.getWallet(SYSTEM_WALLETS.TEEN_PATTI_POOL);
  return res.json({
    game: 'teen-patti',
    name: 'Teen Patti Royal (Player vs Dealer)',
    status: 'ACTIVE',
    minBet: '50',
    maxBet: '500000',
    poolBalance: poolWallet ? poolWallet.balance : '2000000',
    handRankings: [
      { rank: 1, name: 'Trail (Trio / AAA)', multiplier: '40x' },
      { rank: 2, name: 'Pure Sequence (Straight Flush)', multiplier: '20x' },
      { rank: 3, name: 'Sequence (Run / AKQ)', multiplier: '8x' },
      { rank: 4, name: 'Color (Flush)', multiplier: '4x' },
      { rank: 5, name: 'Pair (Double)', multiplier: '2x' },
      { rank: 6, name: 'High Card', multiplier: '1x' },
    ],
  });
});

// POST /api/games/teen-patti/boot (Start Heads-Up: Player vs Dealer)
teenPattiRouter.post('/boot', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const userWallet = db.getWalletByUserId(user.id);
  if (!userWallet) {
    return res.status(404).json({ error: 'User wallet not found' });
  }

  const requestedBoot = parseInt(req.body.bootAmount || '50', 10);
  const bootAmount = isNaN(requestedBoot) || requestedBoot < 10 ? 50 : requestedBoot;

  if (BigInt(userWallet.balance) < BigInt(bootAmount)) {
    return res.status(400).json({ error: `Insufficient balance for boot amount ₹${bootAmount}` });
  }

  // Deduct boot amount from player wallet into Teen Patti Pool
  try {
    db.executeTransfer({
      sourceWalletId: userWallet.id,
      targetWalletId: SYSTEM_WALLETS.TEEN_PATTI_POOL,
      amount: bootAmount.toString(),
      type: TransactionType.BET_ESCROW_LOCK,
      idempotencyKey: `tp-boot-${user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      description: `Teen Patti Boot Stake - Round #${globalRoundCounter}`,
      metadata: { game: 'teen-patti', roundNumber: globalRoundCounter, bootAmount },
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to place boot bet' });
  }

  // Shuffle and deal 3 cards to Player and 3 cards to Dealer
  const deck = shuffleDeck(createDeck());
  const playerCards = [deck[0], deck[1], deck[2]];
  const dealerCards = [deck[3], deck[4], deck[5]];

  globalRoundCounter++;
  const roundId = `tp-round-${Date.now()}`;

  const table: ActiveTable = {
    roundId,
    roundNumber: globalRoundCounter,
    bootAmount,
    currentStake: bootAmount,
    pot: bootAmount * 2, // Player + Dealer boot
    status: 'BETTING',
    players: [
      {
        id: user.id,
        name: user.username,
        isAi: false,
        cards: playerCards,
        isSeen: false,
        hasFolded: false,
        totalBet: bootAmount,
      },
      {
        id: 'dealer',
        name: 'Dealer',
        isAi: true,
        cards: dealerCards,
        isSeen: false,
        hasFolded: false,
        totalBet: bootAmount,
      },
    ],
    winnerId: null,
    winnerHand: null,
    winAmount: 0,
  };

  activeTables.set(user.id, table);

  const updatedWallet = db.getWalletByUserId(user.id);
  const poolWallet = db.getWallet(SYSTEM_WALLETS.TEEN_PATTI_POOL);

  return res.json({
    table: sanitizeTableForClient(table, user.id),
    wallet: updatedWallet,
    poolBalance: poolWallet ? poolWallet.balance : '2000000',
  });
});

// POST /api/games/teen-patti/action (Chaal, Blind, See, Pack, Showdown)
teenPattiRouter.post('/action', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const table = activeTables.get(user.id);
  if (!table) {
    return res.status(400).json({ error: 'No active Teen Patti game found. Please start a round.' });
  }

  const { action, amount } = req.body;
  const player = table.players.find((p) => p.id === user.id);
  const dealer = table.players.find((p) => p.id === 'dealer');
  if (!player || !dealer || player.hasFolded) {
    return res.status(400).json({ error: 'Invalid move state' });
  }

  const userWallet = db.getWalletByUserId(user.id);
  if (!userWallet) return res.status(404).json({ error: 'User wallet not found' });

  if (action === 'see') {
    player.isSeen = true;
    return res.json({
      table: sanitizeTableForClient(table, user.id),
      wallet: userWallet,
    });
  }

  if (action === 'pack') {
    player.hasFolded = true;
    table.status = 'SETTLED';
    table.winnerId = 'dealer';
    table.winnerHand = evaluateTeenPattiHand(dealer.cards).name;
    table.winAmount = table.pot;

    return res.json({
      table: sanitizeTableForClient(table, user.id, true),
      wallet: userWallet,
    });
  }

  if (action === 'chaal' || action === 'blind') {
    const betAmount = parseInt(amount || table.currentStake.toString(), 10);
    if (BigInt(userWallet.balance) < BigInt(betAmount)) {
      return res.status(400).json({ error: 'Insufficient balance for Chaal' });
    }

    try {
      db.executeTransfer({
        sourceWalletId: userWallet.id,
        targetWalletId: SYSTEM_WALLETS.TEEN_PATTI_POOL,
        amount: betAmount.toString(),
        type: TransactionType.BET_ESCROW_LOCK,
        idempotencyKey: `tp-bet-${user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        description: `Teen Patti ${action.toUpperCase()} bet vs Dealer`,
        metadata: { roundId: table.roundId, action, amount: betAmount },
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Error processing bet' });
    }

    player.totalBet += betAmount;
    // Dealer matches bet to pot
    dealer.totalBet += betAmount;
    table.pot += betAmount * 2;

    const updatedWallet = db.getWalletByUserId(user.id);
    return res.json({
      table: sanitizeTableForClient(table, user.id),
      wallet: updatedWallet,
    });
  }

  if (action === 'showdown') {
    table.status = 'SETTLED';

    // Compare Player hand with Dealer hand
    const comparison = compareHands(player.cards, dealer.cards);
    const playerWon = comparison >= 0; // Player wins on tie or higher hand

    const bestPlayer = playerWon ? player : dealer;
    const bestHandEval = evaluateTeenPattiHand(bestPlayer.cards);

    table.winnerId = bestPlayer.id;
    table.winnerHand = `${bestHandEval.name} - ${bestHandEval.description}`;
    table.winAmount = table.pot;

    // If human player won, payout table.pot from TEEN_PATTI_POOL to user wallet!
    if (playerWon) {
      try {
        db.executeTransfer({
          sourceWalletId: SYSTEM_WALLETS.TEEN_PATTI_POOL,
          targetWalletId: userWallet.id,
          amount: table.pot.toString(),
          type: TransactionType.BET_WIN_PAYOUT,
          idempotencyKey: `tp-win-${user.id}-${table.roundId}-${Date.now()}`,
          description: `Teen Patti Win Payout vs Dealer - Round #${table.roundNumber}`,
          metadata: { roundId: table.roundId, winAmount: table.pot, hand: table.winnerHand },
        });
      } catch (err: any) {
        console.error('Teen Patti win payout error:', err);
      }
    }

    const updatedWallet = db.getWalletByUserId(user.id);
    const poolWallet = db.getWallet(SYSTEM_WALLETS.TEEN_PATTI_POOL);

    return res.json({
      table: sanitizeTableForClient(table, user.id, true),
      wallet: updatedWallet,
      poolBalance: poolWallet ? poolWallet.balance : '2000000',
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
});

function sanitizeTableForClient(table: ActiveTable, currentUserId: string, revealAll = false) {
  return {
    ...table,
    players: table.players.map((p) => {
      const isSelf = p.id === currentUserId;
      const canSee = revealAll || (isSelf && p.isSeen);
      return {
        id: p.id,
        name: p.name,
        isAi: p.isAi,
        isSeen: p.isSeen,
        hasFolded: p.hasFolded,
        totalBet: p.totalBet,
        cards: canSee ? p.cards : null,
        handEvaluation: canSee ? evaluateTeenPattiHand(p.cards) : null,
      };
    }),
  };
}
