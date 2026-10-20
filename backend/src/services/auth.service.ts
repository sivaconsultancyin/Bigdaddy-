import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getAuthDatabaseClient } from '../db/postgres';
import { db } from '../db/storage';
import { UserRole, User, Wallet, WalletType } from '../../../shared/src/types';

export interface PersistentAccount {
  user: User;
  passwordHash: string;
  wallet: Wallet | null;
}

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

  private static async findPersistentAccount(column: 'username' | 'id', value: string): Promise<PersistentAccount | null> {
    const sql = getAuthDatabaseClient();
    const rows = column === 'username'
      ? await sql`
          select u.id::text as id, u.username, u.email, u.password_hash as "passwordHash",
                 u.parent_id::text as "parentId", u.referred_by_user_id::text as "referredBy",
                 u.created_at as "createdAt", u.updated_at as "updatedAt",
                 ra.role::text as role,
                 w.id::text as "walletId", w.wallet_type::text as "walletType",
                 w.balance::text as balance, w.reserved_balance::text as "reservedBalance",
                 w.created_at as "walletCreatedAt", w.updated_at as "walletUpdatedAt"
          from public.users u
          left join public.role_assignments ra on ra.user_id = u.id
          left join public.wallets w on w.user_id = u.id
          where lower(u.username) = lower(${value}) and u.is_active = true
          limit 1
        `
      : await sql`
          select u.id::text as id, u.username, u.email, u.password_hash as "passwordHash",
                 u.parent_id::text as "parentId", u.referred_by_user_id::text as "referredBy",
                 u.created_at as "createdAt", u.updated_at as "updatedAt",
                 ra.role::text as role,
                 w.id::text as "walletId", w.wallet_type::text as "walletType",
                 w.balance::text as balance, w.reserved_balance::text as "reservedBalance",
                 w.created_at as "walletCreatedAt", w.updated_at as "walletUpdatedAt"
          from public.users u
          left join public.role_assignments ra on ra.user_id = u.id
          left join public.wallets w on w.user_id = u.id
          where u.id = ${value}::uuid and u.is_active = true
          limit 1
        `;
    const row = rows[0] as any;
    if (!row || !row.role || !row.passwordHash) return null;

    const user: User = {
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role as UserRole,
      parentId: row.parentId ?? null,
      referredBy: row.referredBy ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
    const wallet: Wallet | null = row.walletId ? {
      id: row.walletId,
      userId: row.id,
      walletType: row.walletType as WalletType,
      balance: String(row.balance ?? '0'),
      reservedBalance: String(row.reservedBalance ?? '0'),
      createdAt: new Date(row.walletCreatedAt).toISOString(),
      updatedAt: new Date(row.walletUpdatedAt).toISOString(),
    } : null;

    return { user, passwordHash: row.passwordHash, wallet };
  }

  public static async getPersistentAccountByUsername(username: string): Promise<PersistentAccount | null> {
    return this.findPersistentAccount('username', username);
  }

  public static async getPersistentAccountById(id: string): Promise<PersistentAccount | null> {
    return this.findPersistentAccount('id', id);
  }
}
