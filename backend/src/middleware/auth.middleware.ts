import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { db } from '../db/storage';
import { config } from '../config';
import { UserRole } from '../../../shared/src/types';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: UserRole;
    parentId: string | null;
  };
}

export async function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authentication token' });
  }

  const payload = AuthService.verifyToken(authHeader.split(' ')[1]);
  if (!payload || typeof payload.id !== 'string') {
    return res.status(401).json({ error: 'Expired or invalid authentication token' });
  }

  try {
    if (config.isProduction) {
      const account = await AuthService.getPersistentAccountById(payload.id);
      if (!account) return res.status(401).json({ error: 'User does not exist or is inactive' });
      req.user = {
        id: account.user.id,
        username: account.user.username,
        role: account.user.role,
        parentId: account.user.parentId,
      };
    } else {
      const user = db.getUserById(payload.id);
      if (!user) return res.status(401).json({ error: 'User does not exist' });
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        parentId: user.parentId,
      };
    }
    return next();
  } catch (error) {
    console.error('Authentication user lookup failed:', error);
    if (config.isProduction) {
      return res.status(503).json({ error: 'Authentication service is temporarily unavailable. Please try again.' });
    }
    return res.status(401).json({ error: 'User does not exist' });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Role ${req.user.role} does not have required permissions.`,
      });
    }

    next();
  };
}
