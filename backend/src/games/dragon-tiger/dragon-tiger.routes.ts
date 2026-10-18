import { Router, Response } from 'express';
import { dragonTigerEngine } from './dragon-tiger.engine';
import { authenticateJWT, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { UserRole } from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';

export const dragonTigerRouter = Router();

// GET /api/games/dragon-tiger/state
dragonTigerRouter.get('/state', (req, res: Response) => {
  const poolWallet = db.getWallet(SYSTEM_WALLETS.DRAGON_TIGER_POOL);
  return res.json({
    game: 'dragon-tiger',
    name: 'Dragon Tiger Live',
    status: 'ACTIVE',
    minBet: '10',
    maxBet: '300000',
    poolBalance: poolWallet ? poolWallet.balance : '2000000',
    round: dragonTigerEngine.getPublicRoundState(),
    allBets: dragonTigerEngine.getCurrentRoundBets(),
    history: dragonTigerEngine.getHistory(),
  });
});

// POST /api/games/dragon-tiger/bet
dragonTigerRouter.post('/bet', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can place bets' });
  }

  const { bets } = req.body;
  if (!Array.isArray(bets) || bets.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one bet' });
  }

  try {
    const result = dragonTigerEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      bets,
    });

    const poolWallet = db.getWallet(SYSTEM_WALLETS.DRAGON_TIGER_POOL);

    return res.json({
      ...result,
      round: dragonTigerEngine.getPublicRoundState(),
      poolBalance: poolWallet ? poolWallet.balance : '2000000',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Error placing Dragon Tiger bet' });
  }
});
