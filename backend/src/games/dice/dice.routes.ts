import { Router, Response } from 'express';
import crypto from 'crypto';
import { authenticateJWT, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { UserRole } from '../../../../shared/src/types';
import { SYSTEM_WALLETS } from '../../../../shared/src/constants';
import { db } from '../../db/storage';
import { diceEngine } from './dice.engine';

export const diceRouter = Router();

// GET /api/games/dice/state
diceRouter.get('/state', (req, res: Response) => {
  const poolWallet = db.getWallet(SYSTEM_WALLETS.DICE_POOL);

  return res.json({
    game: 'dice',
    name: 'Lucky 10 Provably Fair Dice',
    status: 'ACTIVE',
    minBet: '10',
    maxBet: '100000',
    poolBalance: poolWallet ? poolWallet.balance : '2000000',
    round: diceEngine.getPublicRoundState(),
    allBets: diceEngine.getCurrentRoundBets(),
    history: diceEngine.getHistory(),
    serverSeedHash: diceEngine.getServerSeedHash(),
  });
});

// POST /api/games/dice/bet (Multiplayer continuous synchronized round bets)
diceRouter.post('/bet', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can place bets' });
  }

  const { bets } = req.body;
  if (!Array.isArray(bets) || bets.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one bet' });
  }

  try {
    const result = diceEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      bets,
    });

    const poolWallet = db.getWallet(SYSTEM_WALLETS.DICE_POOL);

    return res.json({
      ...result,
      round: diceEngine.getPublicRoundState(),
      poolBalance: poolWallet ? poolWallet.balance : '2000000',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Error placing bet' });
  }
});

// POST /api/games/dice/roll (Alias for compatibility with single player bets)
diceRouter.post('/roll', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role !== UserRole.PLAYER) {
    return res.status(403).json({ error: 'Only Player accounts can play Dice' });
  }

  const { bets } = req.body;
  if (!Array.isArray(bets) || bets.length === 0) {
    return res.status(400).json({ error: 'Please select at least one number from 1 to 10' });
  }

  try {
    const result = diceEngine.placeBet({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      bets,
    });

    const poolWallet = db.getWallet(SYSTEM_WALLETS.DICE_POOL);

    return res.json({
      ...result,
      round: diceEngine.getPublicRoundState(),
      poolBalance: poolWallet ? poolWallet.balance : '2000000',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Error placing bet' });
  }
});

// POST /api/games/dice/verify (Independent Provably Fair Verification)
diceRouter.post('/verify', (req, res: Response) => {
  const { serverSeed, clientSeed = 'client-seed-live', nonce } = req.body;
  if (!serverSeed || nonce === undefined) {
    return res.status(400).json({ error: 'Missing verification parameters' });
  }

  const nonceNum = parseInt(nonce, 10);
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonceNum}`);
  const hash = hmac.digest('hex');
  const subHash = hash.substring(0, 8);
  const intVal = parseInt(subHash, 16);
  const calculatedRoll = (intVal % 10) + 1; // 1 to 10
  const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

  return res.json({
    serverSeed,
    serverSeedHash,
    clientSeed,
    nonce: nonceNum,
    calculatedRoll,
  });
});
