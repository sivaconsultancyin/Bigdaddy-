import { Router } from 'express';
import { UserRole } from '../../../shared/src/types';
import { authenticateJWT, requireRole } from '../middleware/auth.middleware';
import { getRecentHealthFailures } from '../services/health-monitor.service';

export const healthMonitorRouter = Router();

healthMonitorRouter.get('/failures', authenticateJWT, requireRole(UserRole.OWNER), async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, Math.floor(rawLimit))) : 100;
  const result = await getRecentHealthFailures(limit);
  return res.json({
    events: result.events,
    persistence: result.persistence,
    capturedInMemoryLimit: 250,
    note: result.persistence === 'memory-fallback'
      ? 'Database logging is unavailable; only recent failures in this API process are shown. Render logs remain the fallback.'
      : 'Events are persisted in the platform health-events table when the database is available.',
    timestamp: new Date().toISOString(),
  });
});
