import { Router, Response } from 'express';
import { db } from '../db/storage';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { directTransferSchema } from '../../../shared/src/schemas';
import { UserRole, TransactionType } from '../../../shared/src/types';

export const walletRouter = Router();

// GET /api/wallet/my-wallet
walletRouter.get('/my-wallet', authenticateJWT, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role === UserRole.OWNER) {
    const treasury = db.getTreasuryWallet();
    return res.json({ wallet: treasury });
  }

  const wallet = db.getWalletByUserId(user.id);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }
  return res.json({ wallet });
});

// GET /api/wallet/summary (OWNER only)
// Verifies 10B invariant and returns breakdowns
walletRouter.get('/summary', authenticateJWT, requireRole(UserRole.OWNER), (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = db.getSupplySummary();
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/ledger
// Double-entry ledger audit trail
walletRouter.get('/ledger', authenticateJWT, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.role === UserRole.OWNER) {
    const allEntries = db.getLedgerEntries(undefined, 100);
    return res.json({ entries: allEntries });
  }

  const wallet = db.getWalletByUserId(user.id);
  if (!wallet) {
    return res.json({ entries: [] });
  }

  const userEntries = db.getLedgerEntries(wallet.id, 50);
  return res.json({ entries: userEntries });
});

// POST /api/wallet/transfer
// Direct token distribution within authorized hierarchy (e.g. Admin -> Player)
walletRouter.post('/transfer', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const sender = req.user!;
  if (sender.role === UserRole.PLAYER) {
    return res.status(403).json({ error: 'Players cannot execute direct outbound transfers' });
  }

  const parseResult = directTransferSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Validation error' });
  }

  const { recipientId, amount, note } = parseResult.data;
  const recipient = db.getUserById(recipientId);
  if (!recipient) {
    return res.status(404).json({ error: 'Recipient user not found' });
  }

  // Enforce hierarchy rules:
  // Owner can transfer to SuperAdmins
  // SuperAdmin can transfer to their own Admins
  // Admin can transfer to their own Players
  if (sender.role === UserRole.OWNER) {
    if (recipient.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ error: 'Owner can only transfer to Super Admins' });
    }
  } else if (sender.role === UserRole.SUPER_ADMIN) {
    if (recipient.role !== UserRole.ADMIN || recipient.parentId !== sender.id) {
      return res.status(403).json({ error: 'Super Admin can only transfer to Admins in their hierarchy' });
    }
  } else if (sender.role === UserRole.ADMIN) {
    if (recipient.role !== UserRole.PLAYER || recipient.parentId !== sender.id) {
      return res.status(403).json({ error: 'Admin can only transfer to Players in their hierarchy' });
    }
  }

  const senderWallet = sender.role === UserRole.OWNER ? db.getTreasuryWallet() : db.getWalletByUserId(sender.id);
  const targetWallet = db.getWalletByUserId(recipient.id);

  if (!senderWallet || !targetWallet) {
    return res.status(400).json({ error: 'Wallets not available' });
  }

  try {
    const tx = db.executeTransfer({
      sourceWalletId: senderWallet.id,
      targetWalletId: targetWallet.id,
      amount,
      type:
        sender.role === UserRole.OWNER
          ? TransactionType.TREASURY_TO_ROLE
          : sender.role === UserRole.SUPER_ADMIN
          ? TransactionType.ROLE_TO_ROLE
          : TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: `TRANSFER_${sender.id}_${recipient.id}_${Date.now()}`,
      description: `Transfer from ${sender.username} to ${recipient.username}: ${note || ''}`,
      metadata: { senderId: sender.id, recipientId: recipient.id, note },
    });

    db.logAudit({
      actorId: sender.id,
      actorUsername: sender.username,
      actorRole: sender.role,
      action: 'DIRECT_TRANSFER',
      targetType: 'WALLET',
      targetId: targetWallet.id,
      details: { amount, recipientUsername: recipient.username, txId: tx.id },
    });

    return res.json({
      message: `Successfully transferred ${amount} tokens to ${recipient.username}`,
      transaction: tx,
      senderWallet: db.getWallet(senderWallet.id),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
