import { Router, Response } from 'express';
import { rouletteEngine } from './roulette.engine';
import { authenticateJWT, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { rouletteSpinSchema } from '../../../../shared/src/schemas';
import { UserRole } from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';

export const rouletteRouter = Router();

// GET /api/games/roulette/state
rouletteRouter.get('/state', (req, res: Response) => {
  const poolWallet = db.getWallet(SYSTEM_WALLETS.ROULETTE_POOL);
  return res.json({
    game: 'roulette',
    name: 'European Roulette',
    status: 'ACTIVE',
    minBet: '10',
    maxBet: '250000',
    poolBalance: poolWallet ? poolWallet.balance : '0',
    round: rouletteEngine.getPublicRoundState(),
    allBets: rouletteEngine.getCurrentRoundBets(),
    history: rouletteEngine.getHistory(),
  });
});

// POST /api/games/roulette/bet (PLAYER only)
rouletteRouter.post('/bet', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can place bets on casino games' });
  }

  const parseResult = rouletteSpinSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  try {
    const result = rouletteEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      bets: parseResult.data.bets,
    });

    const poolWallet = db.getWallet(SYSTEM_WALLETS.ROULETTE_POOL);

    return res.json({
      ...result,
      round: rouletteEngine.getPublicRoundState(),
      poolBalance: poolWallet ? poolWallet.balance : '0',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Error placing roulette bet' });
  }
});

// POST /api/games/roulette/spin (Compatibility alias to /bet)
rouletteRouter.post('/spin', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can place bets on casino games' });
  }

  const parseResult = rouletteSpinSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  try {
    const result = rouletteEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      bets: parseResult.data.bets,
    });

    const poolWallet = db.getWallet(SYSTEM_WALLETS.ROULETTE_POOL);

    return res.json({
      ...result,
      round: rouletteEngine.getPublicRoundState(),
      poolBalance: poolWallet ? poolWallet.balance : '0',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Error executing roulette bet' });
  }
});
