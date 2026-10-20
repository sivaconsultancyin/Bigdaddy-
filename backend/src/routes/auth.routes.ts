import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/storage';
import { AuthService } from '../services/auth.service';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { loginSchema, createUserSchema, referralRegisterSchema } from '../../../shared/src/schemas';
import { UserRole, TransactionType } from '../../../shared/src/types';
import { config } from '../config';

export const authRouter = Router();

// POST /api/auth/login
authRouter.post('/login', async (req, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { username, password } = parseResult.data;

  try {
    if (config.isProduction) {
      const account = await AuthService.getPersistentAccountByUsername(username);
      if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const token = AuthService.generateToken(account.user);
      return res.json({ token, user: account.user, wallet: account.wallet });
    }

    const user = db.getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = AuthService.generateToken(user);
    const wallet = db.getWalletByUserId(user.id);
    const { passwordHash: _, ...safeUser } = user;
    return res.json({ token, user: safeUser, wallet });
  } catch (error) {
    console.error('Login account lookup failed:', error);
    return res.status(503).json({ error: 'Login service is temporarily unavailable. Please try again.' });
  }
});

// POST /api/auth/register-referral
// Only allowed via a valid, active referral code belonging to an active Player
authRouter.post('/register-referral', async (req, res: Response) => {
  const parseResult = referralRegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { username, email, password, referralCode } = parseResult.data;

  const referral = db.getReferralCode(referralCode);
  if (!referral || !referral.active) {
    return res.status(400).json({ error: 'Invalid or inactive referral code' });
  }

  // Prevent duplicate username or email
  if (db.getUserByUsername(username)) {
    return res.status(409).json({ error: 'Username is already taken' });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  try {
    const newUser = db.createUser({
      username,
      email,
      password,
      role: UserRole.PLAYER, // Always PLAYER, no escalation
      parentId: referral.adminId, // Responsible Admin from referral
      referredBy: referral.ownerUserId, // Referring Player
    });

    const token = AuthService.generateToken(newUser);
    const wallet = db.getWalletByUserId(newUser.id);

    db.logAudit({
      actorId: newUser.id,
      actorUsername: newUser.username,
      actorRole: UserRole.PLAYER,
      action: 'REFERRAL_REGISTRATION',
      targetType: 'USER',
      targetId: newUser.id,
      details: { referralCode, referringPlayerId: referral.ownerUserId, adminId: referral.adminId },
    });

    return res.status(201).json({
      message: 'Account successfully registered via referral',
      token,
      user: newUser,
      wallet,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/create-user
// Strictly enforced hierarchical user creation:
// - Owner can create Super Admin only
// - Super Admin can create Admin only
// - Admin can create Player only
// - Player cannot create users
authRouter.post('/create-user', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const creator = req.user!;
  const parseResult = createUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { username, email, password, role, initialTokens } = parseResult.data;

  // Strict Hierarchy Permission Validation
  if (creator.role === UserRole.OWNER) {
    if (role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ error: 'Owner can only create Super Admin accounts' });
    }
  } else if (creator.role === UserRole.SUPER_ADMIN) {
    if (role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Super Admin can only create Admin accounts' });
    }
  } else if (creator.role === UserRole.ADMIN) {
    if (role !== UserRole.PLAYER) {
      return res.status(403).json({ error: 'Admin can only create Player accounts' });
    }
  } else {
    return res.status(403).json({ error: 'Players cannot create other accounts directly' });
  }

  try {
    const newUser = db.createUser({
      username,
      email,
      password,
      role,
      parentId: creator.id, // Linked to responsible creator
    });

    // If initial tokens requested and creator has sufficient balance, execute transfer
    const initialTokensBigInt = BigInt(initialTokens || '0');
    if (initialTokensBigInt > 0n) {
      const creatorWallet =
        creator.role === UserRole.OWNER
          ? db.getTreasuryWallet()
          : db.getWalletByUserId(creator.id);

      const targetWallet = db.getWalletByUserId(newUser.id);

      if (creatorWallet && targetWallet) {
        db.executeTransfer({
          sourceWalletId: creatorWallet.id,
          targetWalletId: targetWallet.id,
          amount: initialTokens,
          type:
            creator.role === UserRole.OWNER
              ? TransactionType.TREASURY_TO_ROLE
              : creator.role === UserRole.SUPER_ADMIN
              ? TransactionType.ROLE_TO_ROLE
              : TransactionType.ROLE_TO_PLAYER,
          idempotencyKey: `INIT_TOKEN_${newUser.id}_${Date.now()}`,
          description: `Initial balance from ${creator.username} to new ${role} ${newUser.username}`,
        });
      }
    }

    db.logAudit({
      actorId: creator.id,
      actorUsername: creator.username,
      actorRole: creator.role,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: newUser.id,
      details: { newRole: role, initialTokens },
    });

    return res.status(201).json({
      message: `${role} account created successfully`,
      user: newUser,
      wallet: db.getWalletByUserId(newUser.id),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  if (config.isProduction) {
    try {
      const account = await AuthService.getPersistentAccountById(req.user!.id);
      if (!account) return res.status(404).json({ error: 'User not found' });
      return res.json({ user: account.user, wallet: account.wallet });
    } catch (error) {
      console.error('Current-user lookup failed:', error);
      return res.status(503).json({ error: 'Authentication service is temporarily unavailable. Please try again.' });
    }
  }

  const user = db.getUserById(req.user!.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash: _, ...safeUser } = user;
  return res.json({ user: safeUser, wallet: db.getWalletByUserId(user.id) });
});

// GET /api/auth/users
// Returns users strictly partitioned by hierarchy
authRouter.get('/users', authenticateJWT, (req: AuthenticatedRequest, res: Response) => {
  const authorizedUsers = db.getAuthorizedUsers(req.user!.id);
  // Attach wallet balances
  const usersWithWallets = authorizedUsers.map((u) => ({
    ...u,
    wallet: db.getWalletByUserId(u.id),
  }));
  return res.json({ users: usersWithWallets });
});

// GET /api/auth/admin-payment-info
// For players to view their assigned Admin's UPI and QR code photo
authRouter.get('/admin-payment-info', authenticateJWT, (req: AuthenticatedRequest, res: Response) => {
  const currentUser = db.getUserById(req.user!.id);
  if (!currentUser) return res.status(404).json({ error: 'User not found' });

  // Locate assigned Admin
  let admin = null;
  if (currentUser.parentId) {
    const parent = db.getUserById(currentUser.parentId);
    if (parent && (parent.role === UserRole.ADMIN || parent.role === UserRole.SUPER_ADMIN)) {
      admin = parent;
    }
  }

  // Fallback by referral
  if (!admin && currentUser.referredBy) {
    const referrer = db.getUserById(currentUser.referredBy);
    if (referrer?.parentId) {
      admin = db.getUserById(referrer.parentId) || null;
    }
  }

  // Fallback to any ADMIN
  if (!admin) {
    const defaultAdmin = db.getUserByUsername('admin_bravo');
    if (defaultAdmin) admin = defaultAdmin;
  }

  const upiId = admin?.upiId || 'admin.bravo@oksbi';
  const paymentAccountName = admin?.paymentAccountName || `${admin?.username || 'Admin Bravo'} Official Agent`;
  const defaultQr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=${paymentAccountName}&cu=INR`)}`;
  const upiQrCode = admin?.upiQrCode || defaultQr;

  return res.json({
    adminId: admin?.id || null,
    adminUsername: admin?.username || 'admin_bravo',
    upiId,
    upiQrCode,
    paymentAccountName,
  });
});

// PUT /api/auth/payment-details
// For Admin (or authorized staff) to update their UPI ID and QR code photo
authRouter.put('/payment-details', authenticateJWT, (req: AuthenticatedRequest, res: Response) => {
  const { upiId, upiQrCode, paymentAccountName } = req.body;
  const user = db.getUserById(req.user!.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const updatedUser = db.updateUserPaymentDetails(user.id, {
      upiId: typeof upiId === 'string' ? upiId.trim() : user.upiId,
      upiQrCode: typeof upiQrCode === 'string' ? upiQrCode.trim() : user.upiQrCode,
      paymentAccountName: typeof paymentAccountName === 'string' ? paymentAccountName.trim() : user.paymentAccountName,
    });

    db.logAudit({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      action: 'PAYMENT_DETAILS_UPDATED',
      targetType: 'USER',
      targetId: user.id,
      details: { upiId: updatedUser.upiId, hasQrPhoto: !!updatedUser.upiQrCode },
    });

    const { passwordHash: _, ...safeUser } = updatedUser;
    return res.json({
      message: 'Payment details successfully updated',
      user: safeUser,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
