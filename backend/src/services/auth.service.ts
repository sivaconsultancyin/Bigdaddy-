import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/storage';
import { UserRole, User } from '../../../shared/src/types';

export class AuthService {
  public static generateToken(user: User): string {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        parentId: user.parentId,
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  public static verifyToken(token: string): any {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch (err) {
      return null;
    }
  }
}
