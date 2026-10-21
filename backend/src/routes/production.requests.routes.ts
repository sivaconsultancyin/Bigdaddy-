import { Router, Request, Response, NextFunction } from 'express';
import { getAuthDatabaseClient, getDatabaseClient } from '../db/postgres';
import { AuthService } from '../services/auth.service';
import { tokenRequestSchema, approveTokenRequestSchema, rejectTokenRequestSchema } from '../../../shared/src/schemas';
import { UserRole, TransactionType } from '../../../shared/src/types';

export const productionRequestsRouter = Router();
type RequestUser = { id: string; username: string; role: UserRole; parent_id: string | null };
type AuthReq = Request & { actor?: RequestUser };

async function auth(req: AuthReq, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const payload = AuthService.verifyToken(header.slice(7));
    if (!payload?.id) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const sql = getAuthDatabaseClient();
    const rows = await sql.unsafe('SELECT u.id,u.username,u.parent_id,ra.role FROM public.users u JOIN public.role_assignments ra ON ra.user_id=u.id WHERE u.id=$1 AND u.is_active=true LIMIT 1', [payload.id]);
    if (!rows[0]) return res.status(401).json({ error: 'USER_NOT_FOUND' });
    req.actor = rows[0] as unknown as RequestUser;
    next();
  } catch (error) {
    console.error('Token request auth failed:', error);
    return res.status(503).json({ error: 'DATABASE_UNAVAILABLE' });
  }
}

productionRequestsRouter.post('/requests/create', auth, async (req: AuthReq, res: Response) => {
  const actor = req.actor!;
  if (actor.role === UserRole.OWNER) return res.status(400).json({ error: 'OWNER_DOES_NOT_REQUEST_TOKENS' });
  const parsed = tokenRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_INPUT' });
  if (!actor.parent_id) return res.status(400).json({ error: 'APPROVER_NOT_CONFIGURED' });
  try {
    const sql = getDatabaseClient();
    const rows = await sql.unsafe("INSERT INTO public.token_requests(requester_id,approver_id,amount,status,requester_note) VALUES($1,$2,$3::bigint,'PENDING',$4) RETURNING id,requester_id AS \"requesterId\",approver_id AS \"approverId\",amount::text AS amount,status,requester_note AS note,created_at AS \"createdAt\"", [actor.id, actor.parent_id, parsed.data.amount, parsed.data.note || null]);
    await sql.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'TOKEN_REQUEST_CREATED','TOKEN_REQUEST',$2,$3::jsonb)", [actor.id, rows[0].id, JSON.stringify({ amount: parsed.data.amount, approverId: actor.parent_id })]);
    return res.status(201).json({ request: rows[0] });
  } catch (error) {
    console.error('Token request creation failed:', error);
    return res.status(400).json({ error: 'TOKEN_REQUEST_CREATION_FAILED' });
  }
});

productionRequestsRouter.get('/requests/list', auth, async (req: AuthReq, res: Response) => {
  const sql = getDatabaseClient();
  const rows = await sql.unsafe('SELECT tr.id,tr.requester_id AS "requesterId",ru.username AS "requesterUsername",rr.role AS "requesterRole",tr.approver_id AS "approverId",au.username AS "approverUsername",tr.amount::text AS amount,tr.status,tr.requester_note AS note,tr.decision_note AS "decisionNote",tr.created_at AS "createdAt",tr.resolved_at AS "resolvedAt" FROM public.token_requests tr JOIN public.users ru ON ru.id=tr.requester_id JOIN public.role_assignments rr ON rr.user_id=ru.id LEFT JOIN public.users au ON au.id=tr.approver_id WHERE tr.requester_id=$1 OR tr.approver_id=$1 ORDER BY tr.created_at DESC LIMIT 200', [req.actor!.id]);
  return res.json({ requests: rows });
});

productionRequestsRouter.post('/requests/:id/approve', auth, async (req: AuthReq, res: Response) => {
  const actor = req.actor!;
  if (actor.role === UserRole.PLAYER) return res.status(403).json({ error: 'PLAYER_CANNOT_APPROVE_REQUESTS' });
  const parsed = approveTokenRequestSchema.safeParse(req.body || {});
  const note = parsed.success ? parsed.data.decisionNote || null : null;
  try {
    const sql = getDatabaseClient();
    const result = await sql.begin(async (tx) => {
      const rows = await tx.unsafe('SELECT id,requester_id,approver_id,amount::text AS amount,status FROM public.token_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
      const request = rows[0];
      if (!request) throw new Error('REQUEST_NOT_FOUND');
      if (request.approver_id !== actor.id) throw new Error('NOT_ASSIGNED_APPROVER');
      if (request.status !== 'PENDING') throw new Error('REQUEST_ALREADY_RESOLVED');
      const users = await tx.unsafe('SELECT u.parent_id,ra.role FROM public.users u JOIN public.role_assignments ra ON ra.user_id=u.id WHERE u.id=$1 AND u.is_active=true', [request.requester_id]);
      if (!users[0] || users[0].parent_id !== actor.id) throw new Error('ROLE_HIERARCHY_VIOLATION');
      const expected = actor.role === UserRole.OWNER ? UserRole.SUPER_ADMIN : actor.role === UserRole.SUPER_ADMIN ? UserRole.ADMIN : UserRole.PLAYER;
      if (users[0].role !== expected) throw new Error('ROLE_HIERARCHY_VIOLATION');
      const source = actor.role === UserRole.OWNER ? await tx.unsafe("SELECT id FROM public.wallets WHERE wallet_type='TREASURY' LIMIT 1") : await tx.unsafe('SELECT id FROM public.wallets WHERE user_id=$1 LIMIT 1', [actor.id]);
      const target = await tx.unsafe('SELECT id FROM public.wallets WHERE user_id=$1 LIMIT 1', [request.requester_id]);
      if (!source[0] || !target[0]) throw new Error('WALLET_NOT_FOUND');
      const type = actor.role === UserRole.OWNER ? TransactionType.TREASURY_TO_ROLE : actor.role === UserRole.SUPER_ADMIN ? TransactionType.ROLE_TO_ROLE : TransactionType.ROLE_TO_PLAYER;
      const moved = await tx.unsafe('SELECT wallet.wallet_transfer_atomic($1,$2::public.transaction_type_enum,$3::bigint,$4::uuid,$5::uuid,$6::jsonb) AS id', ['TOKEN_REQUEST_' + request.id, type, request.amount, source[0].id, target[0].id, JSON.stringify({ requestId: request.id, approvedBy: actor.id })]);
      await tx.unsafe('UPDATE public.wallet_transactions SET token_request_id=$1 WHERE id=$2', [request.id, moved[0].id]);
      await tx.unsafe("UPDATE public.token_requests SET status='APPROVED',decision_note=$1,resolved_at=now() WHERE id=$2", [note, request.id]);
      await tx.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'TOKEN_REQUEST_APPROVED','TOKEN_REQUEST',$2,$3::jsonb)", [actor.id, request.id, JSON.stringify({ amount: request.amount, transactionId: moved[0].id })]);
      return { requestId: request.id, transactionId: moved[0].id, amount: request.amount };
    });
    return res.json({ message: 'TOKEN_REQUEST_APPROVED', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'APPROVAL_FAILED';
    if (message.includes('NOT_ASSIGNED') || message.includes('HIERARCHY')) return res.status(403).json({ error: message });
    if (message.includes('REQUEST_NOT_FOUND')) return res.status(404).json({ error: message });
    if (message.includes('ALREADY_RESOLVED')) return res.status(409).json({ error: message });
    if (message.includes('INSUFFICIENT_FUNDS')) return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
    console.error('Token approval failed:', error);
    return res.status(400).json({ error: 'TOKEN_REQUEST_APPROVAL_FAILED' });
  }
});

productionRequestsRouter.post('/requests/:id/reject', auth, async (req: AuthReq, res: Response) => {
  const actor = req.actor!;
  if (actor.role === UserRole.PLAYER) return res.status(403).json({ error: 'PLAYER_CANNOT_REJECT_REQUESTS' });
  const parsed = rejectTokenRequestSchema.safeParse(req.body || {});
  const note = parsed.success ? parsed.data.decisionNote || null : null;
  try {
    const sql = getDatabaseClient();
    const rows = await sql.unsafe("UPDATE public.token_requests SET status='REJECTED',decision_note=$1,resolved_at=now() WHERE id=$2 AND approver_id=$3 AND status='PENDING' RETURNING id,amount::text AS amount,status", [note, req.params.id, actor.id]);
    if (!rows[0]) return res.status(409).json({ error: 'REQUEST_NOT_FOUND_OR_NOT_ASSIGNED_OR_ALREADY_RESOLVED' });
    await sql.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'TOKEN_REQUEST_REJECTED','TOKEN_REQUEST',$2,$3::jsonb)", [actor.id, rows[0].id, JSON.stringify({ amount: rows[0].amount })]);
    return res.json({ request: rows[0] });
  } catch (error) {
    console.error('Token rejection failed:', error);
    return res.status(400).json({ error: 'TOKEN_REQUEST_REJECTION_FAILED' });
  }
});
