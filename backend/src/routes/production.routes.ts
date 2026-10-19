import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { getDatabaseClient } from '../db/postgres';
import { AuthService } from '../services/auth.service';
import { loginSchema, createUserSchema, referralRegisterSchema, directTransferSchema } from '../../../shared/src/schemas';
import { UserRole, TransactionType } from '../../../shared/src/types';

export const productionRouter = Router();
type UserRow = { id: string; username: string; email: string; password_hash: string; role: UserRole; parent_id: string | null; referred_by_user_id: string | null; is_active: boolean };
type AuthReq = Request & { authUser?: UserRow };

function safeUser(user: UserRow) {
  return { id: user.id, username: user.username, email: user.email, role: user.role, parentId: user.parent_id, referredBy: user.referred_by_user_id };
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
    const sql = getDatabaseClient();
    const rows = await sql.unsafe('SELECT u.id,u.username,u.email,u.password_hash,u.parent_id,u.referred_by_user_id,u.is_active,ra.role FROM public.users u JOIN public.role_assignments ra ON ra.user_id=u.id WHERE u.id=$1 AND u.is_active=true LIMIT 1', [payload.id]);
    if (!rows[0]) return res.status(401).json({ error: 'USER_NOT_FOUND_OR_DISABLED' });
    req.authUser = rows[0] as UserRow;
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
    const sql = getDatabaseClient();
    const rows = await sql.unsafe('SELECT u.id,u.username,u.email,u.password_hash,u.parent_id,u.referred_by_user_id,u.is_active,ra.role FROM public.users u JOIN public.role_assignments ra ON ra.user_id=u.id WHERE lower(u.username)=lower($1) LIMIT 1', [parsed.data.username]);
    const user = rows[0] as UserRow | undefined;
    if (!user || !user.is_active || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'INVALID_USERNAME_OR_PASSWORD' });
    const wallets = await sql.unsafe('SELECT id,wallet_type,balance::text AS balance,reserved_balance::text AS reserved_balance,game_code FROM public.wallets WHERE user_id=$1 LIMIT 1', [user.id]);
    await sql.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'USER_LOGIN','USER',$1,$2::jsonb)", [user.id, JSON.stringify({ ip: req.ip })]);
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
  try {
    const sql = getDatabaseClient();
    const created = await sql.begin(async (tx) => {
      const refs = await tx.unsafe("SELECT r.owner_user_id,r.admin_id FROM public.referral_codes r JOIN public.users owner ON owner.id=r.owner_user_id AND owner.is_active=true JOIN public.role_assignments orole ON orole.user_id=owner.id AND orole.role='PLAYER' JOIN public.users admin ON admin.id=r.admin_id AND admin.is_active=true JOIN public.role_assignments arole ON arole.user_id=admin.id AND arole.role='ADMIN' WHERE r.code=$1 AND r.is_active=true AND owner.parent_id=r.admin_id FOR UPDATE OF r", [referralCode]);
      if (!refs[0]) throw new Error('INVALID_REFERRAL_CODE');
      const duplicates = await tx.unsafe('SELECT id FROM public.users WHERE lower(username)=lower($1) OR lower(email)=lower($2) LIMIT 1', [username, email]);
      if (duplicates[0]) throw new Error('DUPLICATE_ACCOUNT');
      const passwordHash = await bcrypt.hash(password, 12);
      const users = await tx.unsafe('INSERT INTO public.users(username,email,password_hash,parent_id,referred_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id,username,email,password_hash,parent_id,referred_by_user_id,is_active', [username, email, passwordHash, refs[0].admin_id, refs[0].owner_user_id]);
      const user = users[0] as UserRow;
      await tx.unsafe("INSERT INTO public.role_assignments(user_id,role,assigned_by) VALUES($1,'PLAYER',$2)", [user.id, refs[0].admin_id]);
      await tx.unsafe("INSERT INTO public.wallets(user_id,wallet_type,balance) VALUES($1,'PLAYER',0)", [user.id]);
      await tx.unsafe('INSERT INTO public.user_profiles(user_id,display_name) VALUES($1,$2)', [user.id, username]);
      await tx.unsafe('UPDATE public.referral_codes SET usage_count=usage_count+1 WHERE code=$1', [referralCode]);
      await tx.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'REFERRAL_REGISTRATION','USER',$1,$2::jsonb)", [user.id, JSON.stringify({ referralCode })]);
      return user;
    });
    const user = created as UserRow;
    const wallets = await sql.unsafe('SELECT id,wallet_type,balance::text AS balance,reserved_balance::text AS reserved_balance FROM public.wallets WHERE user_id=$1 LIMIT 1', [user.id]);
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
  const sql = getDatabaseClient();
  const wallets = await sql.unsafe('SELECT id,wallet_type,balance::text AS balance,reserved_balance::text AS reserved_balance,game_code FROM public.wallets WHERE user_id=$1 LIMIT 1', [user.id]);
  return res.json({ user: safeUser(user), wallet: wallets[0] || null });
});

productionRouter.get('/auth/users', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  if (actor.role === UserRole.PLAYER) return res.status(403).json({ error: 'PLAYERS_CANNOT_LIST_USERS' });
  const sql = getDatabaseClient();
  const rows = await sql.unsafe('WITH RECURSIVE descendants AS (SELECT u.id,u.username,u.email,u.parent_id,u.is_active,u.created_at,ra.role FROM public.users u JOIN public.role_assignments ra ON ra.user_id=u.id WHERE u.parent_id=$1 UNION ALL SELECT c.id,c.username,c.email,c.parent_id,c.is_active,c.created_at,cr.role FROM public.users c JOIN public.role_assignments cr ON cr.user_id=c.id JOIN descendants d ON c.parent_id=d.id) SELECT d.id,d.username,d.email,d.parent_id AS "parentId",d.role,d.is_active AS "isActive",w.id AS "walletId",w.balance::text AS "walletBalance" FROM descendants d LEFT JOIN public.wallets w ON w.user_id=d.id ORDER BY d.created_at DESC', [actor.id]);
  return res.json({ users: rows });
});

productionRouter.post('/auth/create-user', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  const actor = req.authUser!;
  const { username, email, password, role, initialTokens } = parsed.data;
  const allowed = (actor.role === UserRole.OWNER && role === UserRole.SUPER_ADMIN) || (actor.role === UserRole.SUPER_ADMIN && role === UserRole.ADMIN) || (actor.role === UserRole.ADMIN && role === UserRole.PLAYER);
  if (!allowed) return res.status(403).json({ error: 'ROLE_HIERARCHY_VIOLATION' });
  try {
    const sql = getDatabaseClient();
    const user = await sql.begin(async (tx) => {
      const dup = await tx.unsafe('SELECT id FROM public.users WHERE lower(username)=lower($1) OR lower(email)=lower($2) LIMIT 1', [username, email]);
      if (dup[0]) throw new Error('DUPLICATE_ACCOUNT');
      const hash = await bcrypt.hash(password, 12);
      const rows = await tx.unsafe('INSERT INTO public.users(username,email,password_hash,parent_id) VALUES($1,$2,$3,$4) RETURNING id,username,email,password_hash,parent_id,referred_by_user_id,is_active', [username, email, hash, actor.id]);
      const created = rows[0] as UserRow;
      const walletType = role === UserRole.SUPER_ADMIN ? 'SUPER_ADMIN' : role === UserRole.ADMIN ? 'ADMIN' : 'PLAYER';
      await tx.unsafe('INSERT INTO public.role_assignments(user_id,role,assigned_by) VALUES($1,$2,$3)', [created.id, role, actor.id]);
      await tx.unsafe('INSERT INTO public.wallets(user_id,wallet_type,balance) VALUES($1,$2,0)', [created.id, walletType]);
      await tx.unsafe('INSERT INTO public.user_profiles(user_id,display_name) VALUES($1,$2)', [created.id, username]);
      const amount = BigInt(initialTokens || '0');
      if (amount > 0n) {
        const source = actor.role === UserRole.OWNER
          ? await tx.unsafe("SELECT id FROM public.wallets WHERE wallet_type='TREASURY' LIMIT 1")
          : await tx.unsafe('SELECT id FROM public.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
        const target = await tx.unsafe('SELECT id FROM public.wallets WHERE user_id=$1 LIMIT 1', [created.id]);
        if (!source[0] || !target[0]) throw new Error('WALLET_NOT_FOUND');
        const txType = actor.role === UserRole.OWNER ? TransactionType.TREASURY_TO_ROLE : actor.role === UserRole.SUPER_ADMIN ? TransactionType.ROLE_TO_ROLE : TransactionType.ROLE_TO_PLAYER;
        await tx.unsafe('SELECT public.wallet_transfer_atomic($1,$2::public.transaction_type_enum,$3::bigint,$4::uuid,$5::uuid,$6::jsonb)', ['CREATE_' + randomUUID(), txType, amount.toString(), source[0].id, target[0].id, JSON.stringify({ actorId: actor.id, createdUserId: created.id })]);
      }
      await tx.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'USER_CREATED','USER',$2,$3::jsonb)", [actor.id, created.id, JSON.stringify({ role, initialTokens: amount.toString() })]);
      return created;
    });
    return res.status(201).json({ user: safeUser(user as UserRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'USER_CREATION_FAILED';
    if (message.includes('DUPLICATE_ACCOUNT') || message.includes('unique')) return res.status(409).json({ error: 'USERNAME_OR_EMAIL_ALREADY_REGISTERED' });
    console.error('Production user creation failed:', error);
    return res.status(400).json({ error: 'USER_CREATION_FAILED' });
  }
});

productionRouter.get('/wallet/my-wallet', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  const sql = getDatabaseClient();
  const rows = actor.role === UserRole.OWNER
    ? await sql.unsafe("SELECT id,wallet_type,balance::text AS balance,reserved_balance::text AS reserved_balance FROM public.wallets WHERE wallet_type='TREASURY' LIMIT 1")
    : await sql.unsafe('SELECT id,wallet_type,balance::text AS balance,reserved_balance::text AS reserved_balance FROM public.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
  if (!rows[0]) return res.status(404).json({ error: 'WALLET_NOT_FOUND' });
  return res.json({ wallet: rows[0] });
});

productionRouter.get('/wallet/summary', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  if (req.authUser!.role !== UserRole.OWNER) return res.status(403).json({ error: 'OWNER_ONLY' });
  const sql = getDatabaseClient();
  const rows = await sql.unsafe('SELECT ts.max_supply::text AS "maxSupply",ts.total_minted::text AS "totalMinted",COALESCE(sum(w.balance),0)::text AS "totalWalletBalance",(SELECT count(*)::int FROM public.users) AS "userCount" FROM public.token_supply ts CROSS JOIN public.wallets w WHERE ts.id=1 GROUP BY ts.max_supply,ts.total_minted');
  const row = rows[0];
  return res.json({ ...row, invariantHolds: !!row && row.maxSupply === row.totalMinted && row.totalMinted === row.totalWalletBalance });
});

productionRouter.get('/wallet/ledger', requireDatabaseUser, async (req: AuthReq, res: Response) => {
  const actor = req.authUser!;
  const sql = getDatabaseClient();
  const rows = actor.role === UserRole.OWNER
    ? await sql.unsafe('SELECT le.id,le.transaction_id AS "transactionId",le.wallet_id AS "walletId",le.direction,le.amount::text AS amount,le.balance_after::text AS "balanceAfter",le.description,le.created_at AS "createdAt" FROM public.ledger_entries le ORDER BY le.created_at DESC LIMIT 100')
    : await sql.unsafe('SELECT le.id,le.transaction_id AS "transactionId",le.wallet_id AS "walletId",le.direction,le.amount::text AS amount,le.balance_after::text AS "balanceAfter",le.description,le.created_at AS "createdAt" FROM public.ledger_entries le JOIN public.wallets w ON w.id=le.wallet_id WHERE w.user_id=$1 ORDER BY le.created_at DESC LIMIT 50', [actor.id]);
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
      const recipients = await tx.unsafe('SELECT u.id,u.username,u.parent_id,ra.role FROM public.users u JOIN public.role_assignments ra ON ra.user_id=u.id WHERE u.id=$1 AND u.is_active=true LIMIT 1 FOR UPDATE', [recipientId]);
      const recipient = recipients[0];
      if (!recipient) throw new Error('RECIPIENT_NOT_FOUND');
      const allowed = (actor.role === UserRole.OWNER && recipient.role === UserRole.SUPER_ADMIN) || (actor.role === UserRole.SUPER_ADMIN && recipient.role === UserRole.ADMIN && recipient.parent_id === actor.id) || (actor.role === UserRole.ADMIN && recipient.role === UserRole.PLAYER && recipient.parent_id === actor.id);
      if (!allowed) throw new Error('ROLE_HIERARCHY_VIOLATION');
      const source = actor.role === UserRole.OWNER
        ? await tx.unsafe("SELECT id FROM public.wallets WHERE wallet_type='TREASURY' LIMIT 1")
        : await tx.unsafe('SELECT id FROM public.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
      const target = await tx.unsafe('SELECT id FROM public.wallets WHERE user_id=$1 LIMIT 1', [recipientId]);
      if (!source[0] || !target[0]) throw new Error('WALLET_NOT_FOUND');
      const key = String(req.headers['idempotency-key'] || ('TRANSFER_' + randomUUID()));
      const txType = actor.role === UserRole.OWNER ? TransactionType.TREASURY_TO_ROLE : actor.role === UserRole.SUPER_ADMIN ? TransactionType.ROLE_TO_ROLE : TransactionType.ROLE_TO_PLAYER;
      const moved = await tx.unsafe('SELECT public.wallet_transfer_atomic($1,$2::public.transaction_type_enum,$3::bigint,$4::uuid,$5::uuid,$6::jsonb) AS id', [key, txType, amount, source[0].id, target[0].id, JSON.stringify({ senderId: actor.id, recipientId, note })]);
      await tx.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'DIRECT_TRANSFER','WALLET',$2,$3::jsonb)", [actor.id, target[0].id, JSON.stringify({ amount, recipientId, transactionId: moved[0].id })]);
      const balances = await tx.unsafe('SELECT id,balance::text AS balance FROM public.wallets WHERE id IN ($1::uuid,$2::uuid)', [source[0].id, target[0].id]);
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
