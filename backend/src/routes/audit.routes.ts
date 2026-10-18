import { Router, Response } from 'express';
import { db } from '../db/storage';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { UserRole } from '../../../shared/src/types';

export const auditRouter = Router();

// GET /api/audit/logs (OWNER only)
auditRouter.get('/logs', authenticateJWT, requireRole(UserRole.OWNER), (req: AuthenticatedRequest, res: Response) => {
  const logs = db.getAuditLogs(100);
  return res.json({ logs });
});
