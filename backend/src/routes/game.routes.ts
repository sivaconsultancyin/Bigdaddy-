import { Router, Response } from 'express';
import { db } from '../db/storage';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { allocatePoolSchema } from '../../../shared/src/schemas';
import { UserRole } from '../../../shared/src/types';

export const gameRouter = Router();

// GET /api/games/list
gameRouter.get('/list', (req, res: Response) => {
  const games = db.getGames();
  return res.json({ games });
});

// POST /api/games/allocate-pool (OWNER only)
// Allocates tokens directly from Owner Treasury to dedicated Game Pool
gameRouter.post(
  '/allocate-pool',
  authenticateJWT,
  requireRole(UserRole.OWNER),
  async (req: AuthenticatedRequest, res: Response) => {
    const parseResult = allocatePoolSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
    }

    const { gameId, amount } = parseResult.data;

    try {
      const tx = db.allocateTokensToGamePool({
        ownerId: req.user!.id,
        gameId,
        amount,
      });

      db.logAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        actorRole: UserRole.OWNER,
        action: 'GAME_POOL_ALLOCATION',
        targetType: 'GAME_POOL',
        targetId: gameId,
        details: { amount, txId: tx.id },
      });

      return res.json({
        message: `Successfully allocated ${amount} tokens to game pool`,
        transaction: tx,
        games: db.getGames(),
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }
);
