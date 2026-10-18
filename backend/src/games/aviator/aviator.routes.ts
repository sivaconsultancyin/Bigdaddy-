import { Router, Response } from 'express';
import { aviatorEngine } from './aviator.engine';
import { authenticateJWT, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { aviatorBetSchema, aviatorCashoutSchema } from '../../../../shared/src/schemas';
import { UserRole } from '../../../../shared/src/types';
import { db } from '../../db/storage';

export const aviatorRouter = Router();

// GET /api/games/aviator/state
aviatorRouter.get('/state', (req, res: Response) => {
  return res.json({
    round: aviatorEngine.getPublicRoundState(),
    bets: aviatorEngine.getCurrentBets(),
    history: aviatorEngine.getHistory(),
  });
});

// POST /api/games/aviator/bet (PLAYER only)
aviatorRouter.post('/bet', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can place bets on casino games' });
  }

  const parseResult = aviatorBetSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { amount, autoCashoutMultiplier } = parseResult.data;

  try {
    const bet = aviatorEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      amount,
      autoCashoutMultiplier,
    });

    const updatedWallet = db.getWalletByUserId(user.id);

    return res.status(201).json({
      message: 'Bet placed successfully in escrow',
      bet,
      wallet: updatedWallet,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/games/aviator/cashout (PLAYER only)
aviatorRouter.post('/cashout', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can cash out bets' });
  }

  const parseResult = aviatorCashoutSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { betId } = parseResult.data;

  try {
    const bet = aviatorEngine.cashoutBet(user.id, betId);
    const updatedWallet = db.getWalletByUserId(user.id);

    return res.json({
      message: `Cashed out at ${bet.cashedOutMultiplier}x!`,
      bet,
      wallet: updatedWallet,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/games/aviator/history
aviatorRouter.get('/history', (req, res: Response) => {
  return res.json({ history: aviatorEngine.getHistory() });
});
