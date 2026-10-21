import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { getAuthDatabaseClient, getDatabaseClient } from '../db/postgres';
import { AuthService } from '../services/auth.service';
import { loginSchema, createUserSchema, referralRegisterSchema, directTransferSchema, aviatorBetSchema, aviatorCashoutSchema } from '../../../shared/src/schemas';
import { UserRole, TransactionType } from '../../../shared/src/types';

export const productionRouter = Router();
type UserRow = { id: string; username: string; email: string; password_hash: string; role: UserRole; parent_id: string | null; referred_by_user_id: string | null; referral_code?: string | null; is_active: boolean };
type AuthReq = Request & { authUser?: UserRow };

function safeUser(user: UserRow) {
  return { id: user.id, username: user.username, email: user.email, role: user.role, parentId: user.parent_id, referredBy: user.referred_by_user_id, referralCode: user.referral_code || (user as any).referralCode || null };
}
function tokenFor(user: UserRow) {
  return AuthService.generateToken({ ...safeUser(user), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any);
}
async function requireDatabaseUser(req: AuthReq, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const payload = AuthService.verifyToken(header.slice(7));
    if (!payload || !payload.id) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const sql = getAuthDatabaseClient();
    const rows = await sql.unsafe('SELECT u.id,u.username,u.email,u.password_hash,u.parent_id,u.referred_by_user_id,u.is_active,ra.role,rc.code AS referral_code FROM platform.users u JOIN platform.role_assignments ra ON ra.user_id=u.id LEFT JOIN platform.referral_codes rc ON rc.owner_user_id=u.id AND rc.is_active=true WHERE u.id=$1 AND u.is_active=true LIMIT 1', [payload.id]);
    if (!rows[0]) return res.status(401).json({ error: 'USER_NOT_FOUND_OR_DISABLED' });
    req.authUser = rows[0] as unknown as UserRow;
    next();
  } catch (error) {
    console.error('Production authentication failed:', error);
    return res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' });
  }
}

productionRouter.post('/auth/login', async (req, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  try {
    const sql = getAuthDatabaseClient();
    const rows = await sql.unsafe('SELECT u.id,u.username,u.email,u.password_hash,u.parent_id,u.referred_by_user_id,u.is_active,ra.role,rc.code AS referral_code FROM platform.users u JOIN platform.role_assignments ra ON ra.user_id=u.id LEFT JOIN platform.referral_codes rc ON rc.owner_user_id=u.id AND rc.is_active=true WHERE lower(u.username)=lower($1::text) LIMIT 1', [parsed.data.username]);
    const user = rows[0] as unknown as UserRow | undefined;
    if (!user || !user.is_active || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'INVALID_USERNAME_OR_PASSWORD' });
    const wallets = await sql.unsafe('SELECT id,user_id AS "userId",wallet_type AS "walletType",balance::text AS balance,reserved_balance::text AS "reservedBalance",game_code AS "gameCode",created_at AS "createdAt",updated_at AS "updatedAt" FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [user.id]);
    await sql.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'USER_LOGIN','USER',$2,$3::jsonb)", [user.id, user.id, JSON.stringify({ ip: req.ip })]);
    return res.json({ token: tokenFor(user), user: safeUser(user), wallet: wallets[0] || null });
  } catch (error) {
    console.error('Production login failed:', error);
    return res.status(503).json({ error: 'DATABASE_OPERATION_FAILED' });
  }
});

productionRouter.post('/auth/register-referral', async (req, res: Response) => {
  const parsed = referralRegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  const { username, email, password, referralCode } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const sql = getAuthDatabaseClient();
    const created = await sql.begin(async (tx) => {
      const refs = await tx.unsafe("SELECT r.owner_user_id,r.admin_id FROM platform.referral_codes r JOIN platform.users owner ON owner.id=r.owner_user_id AND owner.is_active=true JOIN platform.role_assignments orole ON orole.user_id=owner.id AND orole.role='PLAYER' JOIN platform.users admin ON admin.id=r.admin_id AND admin.is_active=true JOIN platform.role_assignments arole ON arole.user_id=admin.id AND arole.role='ADMIN' WHERE r.code=$1 AND r.is_active=true AND owner.parent_id=r.admin_id FOR UPDATE OF r", [referralCode]);
      if (!refs[0]) throw new Error('INVALID_REFERRAL_CODE');
      const duplicates = await tx.unsafe('SELECT id FROM platform.users WHERE lower(username)=lower($1) OR lower(email)=lower($2) LIMIT 1', [username, email]);
      if (duplicates[0]) throw new Error('DUPLICATE_ACCOUNT');
      const users = await tx.unsafe('INSERT INTO platform.users(username,email,password_hash,parent_id,referred_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id,username,email,password_hash,parent_id,referred_by_user_id,is_active', [username, email, passwordHash, refs[0].admin_id, refs[0].owner_user_id]);
      const user = users[0] as unknown as UserRow;
      await tx.unsafe("INSERT INTO platform.role_assignments(user_id,role,assigned_by) VALUES($1,'PLAYER',$2)", [user.id, refs[0].admin_id]);
      await tx.unsafe("INSERT INTO wallet.wallets(user_id,wallet_type,balance) VALUES($1,'PLAYER',0)", [user.id]);
      await tx.unsafe('INSERT INTO platform.user_profiles(user_id,display_name) VALUES($1,$2)', [user.id, username]);
      const newReferralCode = 'BD' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
      await tx.unsafe('INSERT INTO platform.referral_codes(code,owner_user_id,admin_id,is_active) VALUES($1,$2,$3,true)', [newReferralCode, user.id, refs[0].admin_id]);
      user.referral_code = newReferralCode;
      await tx.unsafe('UPDATE platform.referral_codes SET usage_count=usage_count+1 WHERE code=$1', [referralCode]);
      await tx.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'REFERRAL_REGISTRATION','USER',$2,$3::jsonb)", [user.id, user.id, JSON.stringify({ referralCode })]);
      return user;
    });
    const user = created as unknown as UserRow;
    user.role = UserRole.PLAYER;
    const wallets = await sql.unsafe('SELECT id,user_id AS "userId",wallet_type AS "walletType",balance::text AS balance,reserved_balance::text AS "reservedBalance",created_at AS "createdAt",updated_at AS "updatedAt" FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [user.id]);
    return res.status(201).json({ token: tokenFor(user), user: safeUser(user), wallet: wallets[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REGISTRATION_FAILED';
    if (message.includes('INVALID_REFERRAL_CODE')) return res.status(400).json({ error: message });
    if (message.includes('DUPLICATE_ACCOUNT') || message.includes('unique')) return res.status(409).json({ error: 'USERNAME_OR_EMAIL_ALREADY_REGISTERED' });
    console.error('Production registration failed:', error);
    return res.status(400).json({ error: 'REGISTRATION_FAILED' });
  }
});

productionRouter.get('/auth/me', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const user = req.authUser!;
  const sql = getAuthDatabaseClient();
  const wallets = await sql.unsafe('SELECT id,wallet_type,balance::text AS balance,reserved_balance::text AS reserved_balance,game_code FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [user.id]);
  return res.json({ user: safeUser(user), wallet: wallets[0] || null });
});

productionRouter.get('/auth/users', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role === UserRole.PLAYER) return res.status(403).json({ error: 'PLAYERS_CANNOT_LIST_USERS' });
  const startedAt = Date.now();
  try {
    const sql = getAuthDatabaseClient();
    const rows = await sql.unsafe('WITH RECURSIVE descendants AS (SELECT u.id,u.username,u.email,u.parent_id,u.is_active,u.created_at,ra.role FROM platform.users u JOIN platform.role_assignments ra ON ra.user_id=u.id WHERE u.parent_id=$1 UNION SELECT c.id,c.username,c.email,c.parent_id,c.is_active,c.created_at,cr.role FROM platform.users c JOIN platform.role_assignments cr ON cr.user_id=c.id JOIN descendants d ON c.parent_id=d.id) SELECT d.id,d.username,d.email,d.parent_id AS "parentId",d.role,d.is_active AS "isActive",rc.code AS "referralCode",w.id AS "walletId",w.balance::text AS "walletBalance" FROM descendants d LEFT JOIN wallet.wallets w ON w.user_id=d.id LEFT JOIN platform.referral_codes rc ON rc.owner_user_id=d.id AND rc.is_active=true ORDER BY d.created_at DESC', [actor.id]);
    console.info('Auth users query completed', {
      route: '/auth/users',
      role: actor.role,
      durationMs: Date.now() - startedAt,
      rowCount: rows.length,
    });
    return res.json({ users: rows });
  } catch (error) {
    console.error('Auth users query failed', {
      route: '/auth/users',
      userId: actor.id,
      role: actor.role,
      durationMs: Date.now() - startedAt,
      error,
    });
    return res.status(503).json({ error: 'USER_LIST_SERVICE_UNAVAILABLE' });
  }
});

productionRouter.post('/auth/create-user', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  const actor = req.authUser!;
  const { username, email, password, role, initialTokens } = parsed.data;
  const allowed = (actor.role === UserRole.OWNER && role === UserRole.SUPER_ADMIN) || (actor.role === UserRole.SUPER_ADMIN && role === UserRole.ADMIN) || (actor.role === UserRole.ADMIN && role === UserRole.PLAYER);
  if (!allowed) return res.status(403).json({ error: 'ROLE_HIERARCHY_VIOLATION' });
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const sql = getAuthDatabaseClient();
    const user = await sql.begin(async (tx) => {
      const dup = await tx.unsafe('SELECT id FROM platform.users WHERE lower(username)=lower($1) OR lower(email)=lower($2) LIMIT 1', [username, email]);
      if (dup[0]) throw new Error('DUPLICATE_ACCOUNT');
      const rows = await tx.unsafe('INSERT INTO platform.users(username,email,password_hash,parent_id) VALUES($1,$2,$3,$4) RETURNING id,username,email,password_hash,parent_id,referred_by_user_id,is_active', [username, email, passwordHash, actor.id]);
      const created = rows[0] as unknown as UserRow;
      created.role = role;
      const walletType = role === UserRole.SUPER_ADMIN ? 'SUPER_ADMIN' : role === UserRole.ADMIN ? 'ADMIN' : 'PLAYER';
      await tx.unsafe('INSERT INTO platform.role_assignments(user_id,role,assigned_by) VALUES($1,$2,$3)', [created.id, role, actor.id]);
      await tx.unsafe('INSERT INTO wallet.wallets(user_id,wallet_type,balance) VALUES($1,$2,0)', [created.id, walletType]);
      await tx.unsafe('INSERT INTO platform.user_profiles(user_id,display_name) VALUES($1,$2)', [created.id, username]);
      if (role === UserRole.PLAYER) {
        const referralCode = 'BD' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
        await tx.unsafe('INSERT INTO platform.referral_codes(code,owner_user_id,admin_id,is_active) VALUES($1,$2,$3,true)', [referralCode, created.id, actor.id]);
        created.referral_code = referralCode;
      }
      const amount = BigInt(initialTokens || '0');
      if (amount > 0n) {
        const source = actor.role === UserRole.OWNER
          ? await tx.unsafe("SELECT id FROM wallet.wallets WHERE wallet_type='TREASURY' LIMIT 1")
          : await tx.unsafe('SELECT id FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
        const target = await tx.unsafe('SELECT id FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [created.id]);
        if (!source[0] || !target[0]) throw new Error('WALLET_NOT_FOUND');
        const txType = actor.role === UserRole.OWNER ? TransactionType.TREASURY_TO_ROLE : actor.role === UserRole.SUPER_ADMIN ? TransactionType.ROLE_TO_ROLE : TransactionType.ROLE_TO_PLAYER;
        await tx.unsafe('SELECT wallet.wallet_transfer_atomic($1,$2::public.transaction_type_enum,$3::bigint,$4::uuid,$5::uuid,$6::jsonb)', ['CREATE_' + randomUUID(), txType, amount.toString(), source[0].id, target[0].id, JSON.stringify({ actorId: actor.id, createdUserId: created.id })]);
      }
      await tx.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'USER_CREATED','USER',$2,$3::jsonb)", [actor.id, created.id, JSON.stringify({ role, initialTokens: amount.toString() })]);
      return created;
    });
    const createdUser = user as unknown as UserRow;
    const createdWallet = await sql.unsafe('SELECT id,user_id AS "userId",wallet_type AS "walletType",balance::text AS balance,reserved_balance::text AS "reservedBalance",created_at AS "createdAt",updated_at AS "updatedAt" FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [createdUser.id]);
    return res.status(201).json({ user: { ...safeUser(createdUser), role, referralCode: createdUser.referral_code || null }, wallet: createdWallet[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'USER_CREATION_FAILED';
    if (message.includes('DUPLICATE_ACCOUNT') || message.includes('unique')) return res.status(409).json({ error: 'USERNAME_OR_EMAIL_ALREADY_REGISTERED' });
    console.error('Production user creation failed:', error);
    return res.status(400).json({ error: 'USER_CREATION_FAILED' });
  }
});

productionRouter.get('/wallet/my-wallet', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  const startedAt = Date.now();
  try {
    const sql = getDatabaseClient();
    const rows = actor.role === UserRole.OWNER
      ? await sql.unsafe(`SELECT id,user_id AS "userId",wallet_type AS "walletType",balance::text AS balance,reserved_balance::text AS "reservedBalance",created_at AS "createdAt",updated_at AS "updatedAt" FROM wallet.wallets WHERE wallet_type='TREASURY' LIMIT 1`)
      : await sql.unsafe('SELECT id,user_id AS "userId",wallet_type AS "walletType",balance::text AS balance,reserved_balance::text AS "reservedBalance",created_at AS "createdAt",updated_at AS "updatedAt" FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
    console.info('Wallet my-wallet query completed', {
      route: '/wallet/my-wallet',
      role: actor.role,
      durationMs: Date.now() - startedAt,
      rowFound: Boolean(rows[0]),
    });
    if (!rows[0]) return res.status(404).json({ error: 'WALLET_NOT_FOUND' });
    return res.json({ wallet: rows[0] });
  } catch (error) {
    console.error('Wallet my-wallet query failed', {
      route: '/wallet/my-wallet',
      userId: actor.id,
      role: actor.role,
      durationMs: Date.now() - startedAt,
      error,
    });
    return res.status(503).json({ error: 'WALLET_SERVICE_UNAVAILABLE' });
  }
});

productionRouter.get('/wallet/summary', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  if (req.authUser!.role !== UserRole.OWNER) return res.status(403).json({ error: 'OWNER_ONLY' });
  const sql = getDatabaseClient();
  const rows = await sql.unsafe("SELECT ts.max_supply::text AS \"maxSupply\",ts.total_minted::text AS \"totalMinted\",COALESCE(sum(w.balance),0)::text AS \"totalWalletBalance\",COALESCE(sum(w.balance) FILTER (WHERE w.wallet_type='TREASURY'),0)::text AS \"treasuryBalance\",COALESCE(sum(w.balance) FILTER (WHERE w.wallet_type='GAME_POOL'),0)::text AS \"gamePoolsBalance\",COALESCE(sum(w.balance) FILTER (WHERE w.wallet_type IN ('SUPER_ADMIN','ADMIN','PLAYER')),0)::text AS \"roleWalletsBalance\",COALESCE(sum(w.balance) FILTER (WHERE w.wallet_type='ESCROW'),0)::text AS \"escrowBalance\",(SELECT count(*)::int FROM platform.users) AS \"userCount\" FROM wallet.token_supply ts CROSS JOIN wallet.wallets w WHERE ts.id=1 GROUP BY ts.max_supply,ts.total_minted");
  const row = rows[0];
  const valid = !!row && row.maxSupply === row.totalMinted && row.totalMinted === row.totalWalletBalance;
  const circulating = Math.max(0, Number(row?.totalWalletBalance || 0) - Number(row?.treasuryBalance || 0));
  return res.json({ ...row, circulating: String(circulating), totalCalculated: row?.totalWalletBalance, isSupplyValid: valid, invariantHolds: valid });
});

productionRouter.get('/wallet/ledger', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  const sql = getDatabaseClient();
  const rows = actor.role === UserRole.OWNER
    ? await sql.unsafe('SELECT le.id,le.transaction_id AS "transactionId",le.wallet_id AS "walletId",le.direction,le.amount::text AS amount,le.balance_after::text AS "balanceAfter",le.description,le.created_at AS "createdAt" FROM wallet.ledger_entries le ORDER BY le.created_at DESC LIMIT 100')
    : await sql.unsafe('SELECT le.id,le.transaction_id AS "transactionId",le.wallet_id AS "walletId",le.direction,le.amount::text AS amount,le.balance_after::text AS "balanceAfter",le.description,le.created_at AS "createdAt" FROM wallet.ledger_entries le JOIN wallet.wallets w ON w.id=le.wallet_id WHERE w.user_id=$1 ORDER BY le.created_at DESC LIMIT 50', [actor.id]);
  return res.json({ entries: rows });
});

productionRouter.post('/wallet/transfer', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role === UserRole.PLAYER) return res.status(403).json({ error: 'PLAYERS_CANNOT_TRANSFER' });
  const parsed = directTransferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  const { recipientId, amount, note } = parsed.data;
  try {
    const sql = getDatabaseClient();
    const result = await sql.begin(async (tx) => {
      const recipients = await tx.unsafe('SELECT u.id,u.username,u.parent_id,ra.role FROM platform.users u JOIN platform.role_assignments ra ON ra.user_id=u.id WHERE u.id=$1 AND u.is_active=true LIMIT 1 FOR UPDATE', [recipientId]);
      const recipient = recipients[0];
      if (!recipient) throw new Error('RECIPIENT_NOT_FOUND');
      const allowed = (actor.role === UserRole.OWNER && recipient.role === UserRole.SUPER_ADMIN) || (actor.role === UserRole.SUPER_ADMIN && recipient.role === UserRole.ADMIN && recipient.parent_id === actor.id) || (actor.role === UserRole.ADMIN && recipient.role === UserRole.PLAYER && recipient.parent_id === actor.id);
      if (!allowed) throw new Error('ROLE_HIERARCHY_VIOLATION');
      const source = actor.role === UserRole.OWNER
        ? await tx.unsafe("SELECT id FROM wallet.wallets WHERE wallet_type='TREASURY' LIMIT 1")
        : await tx.unsafe('SELECT id FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
      const target = await tx.unsafe('SELECT id FROM wallet.wallets WHERE user_id=$1 LIMIT 1', [recipientId]);
      if (!source[0] || !target[0]) throw new Error('WALLET_NOT_FOUND');
      const key = String(req.headers['idempotency-key'] || ('TRANSFER_' + randomUUID()));
      const txType = actor.role === UserRole.OWNER ? TransactionType.TREASURY_TO_ROLE : actor.role === UserRole.SUPER_ADMIN ? TransactionType.ROLE_TO_ROLE : TransactionType.ROLE_TO_PLAYER;
      const moved = await tx.unsafe('SELECT wallet.wallet_transfer_atomic($1,$2::public.transaction_type_enum,$3::bigint,$4::uuid,$5::uuid,$6::jsonb) AS id', [key, txType, amount, source[0].id, target[0].id, JSON.stringify({ senderId: actor.id, recipientId, note })]);
      await tx.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'DIRECT_TRANSFER','WALLET',$2,$3::jsonb)", [actor.id, target[0].id, JSON.stringify({ amount, recipientId, transactionId: moved[0].id })]);
      const balances = await tx.unsafe('SELECT id,balance::text AS balance FROM wallet.wallets WHERE id IN ($1::uuid,$2::uuid)', [source[0].id, target[0].id]);
      return { transactionId: moved[0].id, balances };
    });
    return res.json({ message: 'TRANSFER_COMPLETED', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TRANSFER_FAILED';
    if (message.includes('INSUFFICIENT_FUNDS')) return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
    if (message.includes('ROLE_HIERARCHY_VIOLATION')) return res.status(403).json({ error: message });
    if (message.includes('RECIPIENT_NOT_FOUND')) return res.status(404).json({ error: message });
    console.error('Production transfer failed:', error);
    return res.status(400).json({ error: 'TRANSFER_FAILED' });
  }
});


productionRouter.post('/auth/bootstrap-owner', async (req, res: Response) => {
  const expectedSecret = process.env.OWNER_BOOTSTRAP_SECRET;
  const suppliedSecret = req.headers['x-bootstrap-secret'];
  if (!expectedSecret || typeof suppliedSecret !== 'string' || suppliedSecret !== expectedSecret) {
    return res.status(403).json({ error: 'BOOTSTRAP_NOT_AUTHORIZED' });
  }
  const { username, email, password } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 3 ||
      typeof email !== 'string' || !email.includes('@') ||
      typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'USERNAME_EMAIL_AND_12_CHARACTER_PASSWORD_REQUIRED' });
  }
  try {
    const sql = getAuthDatabaseClient();
    const owner = await sql.begin(async (tx) => {
      const exists = await tx.unsafe("SELECT user_id FROM platform.role_assignments WHERE role='OWNER' LIMIT 1 FOR UPDATE");
      if (exists[0]) throw new Error('OWNER_ALREADY_INITIALIZED');
      const hash = await bcrypt.hash(password, 12);
      const rows = await tx.unsafe('INSERT INTO platform.users(username,email,password_hash,parent_id) VALUES($1,$2,$3,NULL) RETURNING id,username,email,password_hash,parent_id,referred_by_user_id,is_active', [username.trim(), email.trim().toLowerCase(), hash]);
      const user = rows[0] as unknown as UserRow;
      user.role = UserRole.OWNER;
      await tx.unsafe("INSERT INTO platform.role_assignments(user_id,role,assigned_by) VALUES($1,'OWNER',NULL)", [user.id]);
      await tx.unsafe('INSERT INTO platform.user_profiles(user_id,display_name) VALUES($1,$2)', [user.id, username.trim()]);
      await tx.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'OWNER_BOOTSTRAPPED','USER',$2,'{}'::jsonb)", [user.id, user.id]);
      return user;
    });
    return res.status(201).json({ message: 'OWNER_CREATED_LOGIN_NOW', user: safeUser(owner as unknown as UserRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BOOTSTRAP_FAILED';
    if (message.includes('OWNER_ALREADY_INITIALIZED') || message.includes('unique')) return res.status(409).json({ error: 'OWNER_ALREADY_INITIALIZED_OR_DUPLICATE_ACCOUNT' });
    console.error('Owner bootstrap failed:', error);
    return res.status(400).json({ error: 'OWNER_BOOTSTRAP_FAILED' });
  }
});

productionRouter.post('/wallet/game-pool', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role !== UserRole.OWNER) return res.status(403).json({ error: 'OWNER_ONLY' });
  const gameCode = String(req.body?.gameCode ?? 'aviator').trim();
  if (!['aviator','roulette','dice','dragon_tiger','andar_bahar'].includes(gameCode)) return res.status(400).json({ error: 'UNKNOWN_GAME' });
  const amountText = String(req.body?.amount ?? '');
  if (!/^[1-9][0-9]*$/.test(amountText) || !Number.isSafeInteger(Number(amountText))) {
    return res.status(400).json({ error: 'POSITIVE_SAFE_INTEGER_AMOUNT_REQUIRED' });
  }
  const suppliedKey = req.headers['idempotency-key'];
  if (typeof suppliedKey !== 'string' || suppliedKey.trim().length < 8 || suppliedKey.length > 200) {
    return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  try {
    const sql = getDatabaseClient();
    const result = await sql.begin(async (tx) => {
      const source = await tx.unsafe("SELECT id FROM wallet.wallets WHERE wallet_type='TREASURY' LIMIT 1 FOR UPDATE");
      const target = await tx.unsafe('SELECT w.id FROM wallet.wallets w JOIN platform.games g ON g.pool_wallet_id=w.id WHERE g.code=$1 LIMIT 1 FOR UPDATE OF w', [gameCode]);
      if (!source[0] || !target[0]) throw new Error('GAME_POOL_WALLET_MISSING');
      const moved = await tx.unsafe(
        "SELECT wallet.wallet_transfer_atomic($1,'POOL_ALLOCATION'::public.transaction_type_enum,$2::bigint,$3::uuid,$4::uuid,$5::jsonb) AS id",
        [suppliedKey.trim(), amountText, source[0].id, target[0].id, JSON.stringify({ allocatedBy: actor.id, game: gameCode })]
      );
      const balance = await tx.unsafe('SELECT balance::text AS balance FROM wallet.wallets WHERE id=$1', [target[0].id]);
      await tx.unsafe(
        "INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'GAME_POOL_ALLOCATION','WALLET',$2,$3::jsonb)",
        [actor.id, target[0].id, JSON.stringify({ amount: amountText, transactionId: moved[0].id, idempotencyKey: suppliedKey.trim() })]
      );
      return { transactionId: moved[0].id, poolBalance: balance[0]?.balance, gameCode };
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'POOL_ALLOCATION_FAILED';
    if (message.includes('INSUFFICIENT_FUNDS')) return res.status(400).json({ error: 'INSUFFICIENT_TREASURY_FUNDS' });
    if (message.includes('GAME_POOL_WALLET_MISSING')) return res.status(503).json({ error: message });
    if (message.includes('unique') || message.includes('duplicate')) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_ALREADY_USED' });
    console.error('Game pool allocation failed:', error);
    return res.status(400).json({ error: 'POOL_ALLOCATION_FAILED' });
  }
});

productionRouter.post('/games/aviator/activate', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  if (req.authUser!.role !== UserRole.OWNER) return res.status(403).json({ error: 'OWNER_ONLY' });
  try {
    const sql = getDatabaseClient();
    const rows = await sql.unsafe("SELECT g.id,w.balance::text AS balance FROM platform.games g JOIN wallet.wallets w ON w.id=g.pool_wallet_id WHERE g.code='aviator' LIMIT 1");
    if (!rows[0] || BigInt(rows[0].balance) <= 0n) return res.status(400).json({ error: 'ALLOCATE_GAME_POOL_TOKENS_FIRST' });
    await sql.unsafe("UPDATE platform.games SET status='ACTIVE',updated_at=now() WHERE code='aviator'");
    await sql.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) SELECT $1,'GAME_ACTIVATED','GAME',id,$2::jsonb FROM platform.games WHERE code='aviator'", [req.authUser!.id, JSON.stringify({ poolBalance: rows[0].balance })]);
    return res.json({ status: 'ACTIVE', poolBalance: rows[0].balance });
  } catch (error) {
    console.error('Crash activation failed:', error);
    return res.status(503).json({ error: 'GAME_ACTIVATION_FAILED' });
  }
});

productionRouter.post('/games/:gameCode/activate', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role !== UserRole.OWNER) return res.status(403).json({ error: 'OWNER_ONLY' });
  const code = String(req.params.gameCode || '').replace(/-/g, '_');
  if (!['roulette','dice','dragon_tiger','andar_bahar'].includes(code)) return res.status(404).json({ error: 'UNKNOWN_GAME' });
  try {
    const sql = getDatabaseClient();
    const rows = await sql.unsafe("SELECT g.id,w.balance::text AS balance FROM platform.games g JOIN wallet.wallets w ON w.id=g.pool_wallet_id WHERE g.code=$1 LIMIT 1", [code]);
    if (!rows[0] || BigInt(rows[0].balance) <= 0n) return res.status(400).json({ error: 'ALLOCATE_GAME_POOL_TOKENS_FIRST' });
    await sql.unsafe("UPDATE platform.games SET status='ACTIVE',updated_at=now() WHERE code=$1", [code]);
    await sql.unsafe("INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details) SELECT $1,'GAME_ACTIVATED','GAME',id,$2::jsonb FROM platform.games WHERE code=$3", [actor.id, JSON.stringify({ poolBalance: rows[0].balance }), code]);
    return res.json({ status: 'ACTIVE', gameCode: code, poolBalance: rows[0].balance });
  } catch (error) {
    console.error('Game activation failed:', error);
    return res.status(503).json({ error: 'GAME_ACTIVATION_FAILED' });
  }
});

productionRouter.get('/games/list', async (_req, res: Response) => {
  try {
    const sql = getDatabaseClient();
    const rows = await sql.unsafe("SELECT g.id,g.code,g.name,g.status,g.pool_wallet_id AS \"poolWalletId\",g.min_bet::text AS \"minBet\",g.max_bet::text AS \"maxBet\",w.balance::text AS \"poolBalance\" FROM platform.games g JOIN wallet.wallets w ON w.id=g.pool_wallet_id ORDER BY g.created_at");
    const games = rows.map((game: any) => ({
      ...game,
      description: game.code === 'aviator' ? 'Crash multiplier game' : game.name,
      iconName: 'Plane',
      route: '/games/' + game.code,
    }));
    return res.json({ games });
  } catch (error) {
    console.error('Production game list failed:', error);
    return res.status(503).json({ error: 'GAME_STORAGE_UNAVAILABLE' });
  }
});

productionRouter.get('/games/aviator/state', async (_req, res: Response) => {
  try {
    const sql = getDatabaseClient();
    const rounds = await sql.unsafe("SELECT id,game_code AS \"gameCode\",round_number AS \"roundNumber\",status,started_at AS \"startedAt\",ended_at AS \"endedAt\",server_seed_hash AS \"serverSeedHash\",revealed_server_seed AS \"revealedServerSeed\",crash_multiplier AS \"crashMultiplier\",EXTRACT(EPOCH FROM (now()-started_at)) AS \"elapsedSeconds\" FROM aviator.game_rounds WHERE game_code='aviator' ORDER BY round_number DESC LIMIT 1");
    if (!rounds[0]) return res.json({ round: null, bets: [], history: [] });
    const round = rounds[0] as any;
    // Derive the live multiplier from PostgreSQL time so a host clock offset cannot desync game state.
    const elapsed = Math.max(0, Number(round.elapsedSeconds) || 0);
    const liveMultiplier = Math.floor(Math.exp(0.06 * Math.pow(elapsed, 1.15)) * 100) / 100;
    const currentMultiplier = round.status === 'RUNNING' ? Math.min(liveMultiplier, Number(round.crashMultiplier)) : ['CRASHED','SETTLED'].includes(round.status) ? Number(round.crashMultiplier || 1) : 1;
    const bets = await sql.unsafe('SELECT b.id,b.round_id AS "roundId",b.bet_amount::text AS "betAmount",b.auto_cashout AS "autoCashout",b.status,b.payout_amount::text AS "payoutAmount",b.cashed_out_at AS "cashedOutAt",u.username FROM aviator.game_bets b JOIN platform.users u ON u.id=b.user_id WHERE b.round_id=$1 ORDER BY b.created_at DESC LIMIT 100', [round.id]);
    const history = await sql.unsafe("SELECT round_number AS \"roundNumber\",crash_multiplier AS \"crashMultiplier\",ended_at AS \"endedAt\",server_seed_hash AS \"serverSeedHash\",revealed_server_seed AS \"revealedServerSeed\" FROM aviator.game_rounds WHERE game_code='aviator' AND status='SETTLED' ORDER BY round_number DESC LIMIT 20");
    const publicRound = { id: round.id, roundNumber: round.roundNumber, status: round.status, startedAt: round.startedAt, endedAt: round.endedAt, multiplier: currentMultiplier, crashMultiplier: ['CRASHED','SETTLED'].includes(round.status) ? round.crashMultiplier : null, serverSeedHash: round.serverSeedHash, revealedServerSeed: round.revealedServerSeed };
    return res.json({ round: publicRound, bets, history });
  } catch (error) {
    console.error('Crash state failed:', error);
    return res.status(503).json({ error: 'GAME_STORAGE_UNAVAILABLE' });
  }
});

productionRouter.get('/games/aviator/history', async (_req, res: Response) => {
  try {
    const sql = getDatabaseClient();
    const history = await sql.unsafe("SELECT round_number AS \"roundNumber\",crash_multiplier AS \"crashMultiplier\",ended_at AS \"endedAt\",server_seed_hash AS \"serverSeedHash\",revealed_server_seed AS \"revealedServerSeed\" FROM aviator.game_rounds WHERE game_code='aviator' AND status='SETTLED' ORDER BY round_number DESC LIMIT 20");
    return res.json({ history });
  } catch (error) {
    console.error('Crash history failed:', error);
    return res.status(503).json({ error: 'GAME_STORAGE_UNAVAILABLE' });
  }
});

productionRouter.post('/games/aviator/bet', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role !== UserRole.PLAYER) return res.status(403).json({ error: 'PLAYER_ONLY' });
  const parsed = aviatorBetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  try {
    const sql = getDatabaseClient();
    const suppliedKey = req.headers['idempotency-key'];
    const key = String(Array.isArray(suppliedKey) ? suppliedKey[0] : suppliedKey || ('BET_' + randomUUID())).trim();
    if (key.length < 8 || key.length > 128) return res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY' });

    // Lock the WAITING round and place the bet in the same DB transaction.
    // The engine must wait for this row lock before moving WAITING -> RUNNING.
    const outcome = await sql.begin(async (tx) => {
      const active = await tx.unsafe(
        "SELECT id FROM aviator.game_rounds WHERE game_code='aviator' AND status='WAITING' ORDER BY round_number DESC LIMIT 1 FOR UPDATE"
      );
      if (!active[0]) {
        const latest = await tx.unsafe(
          "SELECT status FROM aviator.game_rounds WHERE game_code='aviator' ORDER BY round_number DESC LIMIT 1"
        );
        return { error: 'NO_BETTING_ROUND', roundStatus: latest[0]?.status ?? null } as const;
      }
      const created = await tx.unsafe(
        'SELECT aviator.place_crash_bet_atomic($1::uuid,$2::uuid,$3::bigint,$4,$5::numeric) AS id',
        [actor.id, active[0].id, parsed.data.amount, key, parsed.data.autoCashoutMultiplier ?? null]
      );
      const bet = await tx.unsafe(
        'SELECT id,round_id AS "roundId",bet_amount::text AS "betAmount",auto_cashout AS "autoCashout",status FROM aviator.game_bets WHERE id=$1',
        [created[0].id]
      );
      return { bet: bet[0] } as const;
    });
    if ('error' in outcome) return res.status(409).json(outcome);
    return res.status(201).json({ bet: outcome.bet });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BET_FAILED';
    if (message.includes('INSUFFICIENT_FUNDS') || message.includes('GAME_POOL_INSUFFICIENT') || message.includes('BET_OUT_OF_RANGE')) return res.status(400).json({ error: message });
    if (message.includes('BETTING_CLOSED') || message.includes('ROUND_NOT_FOUND')) return res.status(409).json({ error: 'BETTING_CLOSED' });
    if (message.includes('IDEMPOTENCY_KEY_REUSE')) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSE' });
    console.error('Crash bet failed:', error);
    return res.status(400).json({ error: 'BET_FAILED' });
  }
});

productionRouter.post('/games/aviator/cashout', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role !== UserRole.PLAYER) return res.status(403).json({ error: 'PLAYER_ONLY' });
  const parsed = aviatorCashoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  try {
    const sql = getDatabaseClient();
    const key = String(req.headers['idempotency-key'] || ('CASHOUT_' + randomUUID()));
    const rows = await sql.unsafe('SELECT aviator.cashout_crash_bet_atomic($1::uuid,$2::uuid,$3) AS result', [actor.id, parsed.data.betId, key]);
    return res.json({ result: rows[0].result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CASHOUT_FAILED';
    if (message.includes('ROUND_ALREADY_CRASHED') || message.includes('BET_ALREADY_SETTLED')) return res.status(409).json({ error: message });
    console.error('Crash cashout failed:', error);
    return res.status(400).json({ error: 'CASHOUT_FAILED' });
  }
});
