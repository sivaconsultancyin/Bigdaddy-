import { Router, Response } from 'express';
import { andarBaharEngine } from './andar-bahar.engine';
import { authenticateJWT, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { UserRole } from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';

export const andarBaharRouter = Router();

// GET /api/games/andar-bahar/state
andarBaharRouter.get('/state', (req, res: Response) => {
  const poolWallet = db.getWallet(SYSTEM_WALLETS.ANDAR_BAHAR_POOL);
  return res.json({
    game: 'andar-bahar',
    name: 'Andar Bahar Live',
    status: 'ACTIVE',
    minBet: '10',
    maxBet: '200000',
    poolBalance: poolWallet ? poolWallet.balance : '2000000',
    round: andarBaharEngine.getPublicRoundState(),
    allBets: andarBaharEngine.getCurrentRoundBets(),
    history: andarBaharEngine.getHistory(),
  });
});

// POST /api/games/andar-bahar/bet (Place Bet on Andar or Bahar or Side Bets)
andarBaharRouter.post('/bet', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can place bets' });
  }

  const { bets } = req.body;
  if (!Array.isArray(bets) || bets.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one bet' });
  }

  try {
    const result = andarBaharEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      bets,
    });

    const poolWallet = db.getWallet(SYSTEM_WALLETS.ANDAR_BAHAR_POOL);

    return res.json({
      ...result,
      round: andarBaharEngine.getPublicRoundState(),
      poolBalance: poolWallet ? poolWallet.balance : '2000000',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Error placing Andar Bahar bet' });
  }
});
