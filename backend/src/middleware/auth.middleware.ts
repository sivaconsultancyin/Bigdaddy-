import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { db } from '../db/storage';
import { UserRole } from '../../../shared/src/types';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: UserRole;
    parentId: string | null;
  };
}

export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authentication token' });
  }

  const token = authHeader.split(' ')[1];
  const payload = AuthService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Expired or invalid authentication token' });
  }

  const user = db.getUserById(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'User does not exist' });
  }

  req.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    parentId: user.parentId,
  };

  next();
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
