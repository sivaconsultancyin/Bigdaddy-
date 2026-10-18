import { Router, Response } from 'express';
import { db } from '../db/storage';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth.middleware';
import {
  tokenRequestSchema,
  approveTokenRequestSchema,
  rejectTokenRequestSchema,
} from '../../../shared/src/schemas';
import { UserRole } from '../../../shared/src/types';

export const tokenRequestRouter = Router();

// POST /api/requests/create
tokenRequestRouter.post('/create', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role === UserRole.OWNER) {
    return res.status(400).json({ error: 'Owner holds the Treasury and does not request tokens' });
  }

  const parseResult = tokenRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { amount, note } = parseResult.data;

  try {
    const request = db.createTokenRequest({
      requesterId: user.id,
      amount,
      note,
    });

    db.logAudit({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      action: 'TOKEN_REQUEST_CREATED',
      targetType: 'TOKEN_REQUEST',
      targetId: request.id,
      details: { amount, note, approverId: request.approverId },
    });

    return res.status(201).json({
      message: 'Token request submitted successfully to responsible parent',
      request,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/requests/list
tokenRequestRouter.get('/list', authenticateJWT, (req: AuthenticatedRequest, res: Response) => {
  const requests = db.getAuthorizedTokenRequests(req.user!.id);
  return res.json({ requests });
});

// POST /api/requests/:id/approve
tokenRequestRouter.post('/:id/approve', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role === UserRole.PLAYER) {
    return res.status(403).json({ error: 'Players cannot approve token requests' });
  }

  const parseResult = approveTokenRequestSchema.safeParse(req.body);
  const decisionNote = parseResult.success ? parseResult.data.decisionNote : undefined;

  try {
    const result = db.approveTokenRequest({
      requestId: req.params.id,
      approverId: user.id,
      decisionNote,
    });

    db.logAudit({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      action: 'TOKEN_REQUEST_APPROVED',
      targetType: 'TOKEN_REQUEST',
      targetId: result.request.id,
      details: {
        amount: result.request.amount,
        requester: result.request.requesterUsername,
        txId: result.transaction.id,
      },
    });

    return res.json({
      message: `Token request approved. Transferred ${result.request.amount} tokens atomically.`,
      request: result.request,
      transaction: result.transaction,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/requests/:id/reject
tokenRequestRouter.post('/:id/reject', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role === UserRole.PLAYER) {
    return res.status(403).json({ error: 'Players cannot reject token requests' });
  }

  const parseResult = rejectTokenRequestSchema.safeParse(req.body);
  const decisionNote = parseResult.success ? parseResult.data.decisionNote : undefined;

  try {
    const request = db.rejectTokenRequest({
      requestId: req.params.id,
      approverId: user.id,
      decisionNote,
    });

    db.logAudit({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      action: 'TOKEN_REQUEST_REJECTED',
      targetType: 'TOKEN_REQUEST',
      targetId: request.id,
      details: { amount: request.amount, requester: request.requesterUsername },
    });

    return res.json({
      message: 'Token request rejected. No wallet balances were modified.',
      request,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
