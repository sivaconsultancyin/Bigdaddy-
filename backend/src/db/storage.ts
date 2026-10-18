import bcrypt from 'bcryptjs';
import {
  User,
  UserRole,
  Wallet,
  WalletType,
  TokenRequest,
  TokenRequestStatus,
  LedgerEntry,
  LedgerDirection,
  WalletTransaction,
  TransactionType,
  AuditLog,
  GameInfo,
  AviatorBet,
  BetStatus,
  RoundStatus,
} from '../../../shared/src/types';
import {
  MAX_TOKEN_SUPPLY_BIGINT,
  MAX_TOKEN_SUPPLY,
  SYSTEM_WALLETS,
  GAMES_CATALOG,
} from '../../../shared/src/constants';

interface StoredUser extends User {
  passwordHash: string;
}

export class StorageEngine {
  private users: Map<string, StoredUser> = new Map();
  private wallets: Map<string, Wallet> = new Map();
  private ledger: LedgerEntry[] = [];
  private transactions: Map<string, WalletTransaction> = new Map();
  private idempotencyKeys: Set<string> = new Set();
  private tokenRequests: Map<string, TokenRequest> = new Map();
  private referralCodes: Map<string, { code: string; ownerUserId: string; adminId: string; active: boolean }> = new Map();
  private games: Map<string, GameInfo> = new Map();
  private auditLogs: AuditLog[] = [];
  private isInitialized = false;

  constructor() {
    this.initializeGenesisState();
  }

  private initializeGenesisState() {
    if (this.isInitialized) return;

    // 1. Initialize System Wallets
    const treasuryWallet: Wallet = {
      id: SYSTEM_WALLETS.TREASURY,
      userId: null,
      walletType: WalletType.TREASURY,
      balance: MAX_TOKEN_SUPPLY, // 10,000,000,000
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.wallets.set(treasuryWallet.id, treasuryWallet);

    const escrowWallet: Wallet = {
      id: SYSTEM_WALLETS.BET_ESCROW,
      userId: null,
      walletType: WalletType.ESCROW,
      balance: '0',
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.wallets.set(escrowWallet.id, escrowWallet);

    // 2. Initialize Game Pools
    for (const game of GAMES_CATALOG) {
      const poolWallet: Wallet = {
        id: game.poolWalletId,
        userId: null,
        walletType: WalletType.GAME_POOL,
        gameId: game.id,
        balance: '0',
        reservedBalance: '0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.wallets.set(poolWallet.id, poolWallet);

      this.games.set(game.id, {
        id: game.id,
        name: game.name,
        code: game.code,
        status: game.status as any,
        poolWalletId: game.poolWalletId,
        poolBalance: '0',
        minBet: game.minBet,
        maxBet: game.maxBet,
        description: game.description,
        iconName: game.iconName,
        route: game.route,
      });
    }

    // Record Genesis Ledger Entry
    const genesisTx: WalletTransaction = {
      id: 'tx-genesis-001',
      idempotencyKey: 'GENESIS_MINT',
      type: TransactionType.SYSTEM_INITIALIZATION,
      amount: MAX_TOKEN_SUPPLY,
      sourceWalletId: null,
      targetWalletId: SYSTEM_WALLETS.TREASURY,
      status: 'COMPLETED',
      metadata: { reason: 'Genesis 10 Billion Token Allocation' },
      createdAt: new Date().toISOString(),
    };
    this.transactions.set(genesisTx.id, genesisTx);
    this.idempotencyKeys.add('GENESIS_MINT');

    this.ledger.push({
      id: 'led-genesis-001',
      transactionId: genesisTx.id,
      walletId: SYSTEM_WALLETS.TREASURY,
      direction: LedgerDirection.CREDIT,
      amount: MAX_TOKEN_SUPPLY,
      balanceAfter: MAX_TOKEN_SUPPLY,
      description: 'Genesis minting into Owner Treasury',
      timestamp: new Date().toISOString(),
    });

    // 3. Seed Default Hierarchy Accounts for Instant Access & Verification
    // Passwords hashed using bcrypt
    const salt = bcrypt.genSaltSync(10);

    // OWNER
    const ownerUser: StoredUser = {
      id: 'user-owner-001',
      username: 'owner',
      email: 'owner@bigdaddy.casino',
      passwordHash: bcrypt.hashSync('Owner@1234', salt),
      role: UserRole.OWNER,
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(ownerUser.id, ownerUser);

    // SUPER ADMIN (created by Owner)
    const superAdminUser: StoredUser = {
      id: 'user-superadmin-001',
      username: 'superadmin_alpha',
      email: 'superadmin@bigdaddy.casino',
      passwordHash: bcrypt.hashSync('SuperAdmin@1234', salt),
      role: UserRole.SUPER_ADMIN,
      parentId: ownerUser.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(superAdminUser.id, superAdminUser);
    this.createWalletForUser(superAdminUser.id, WalletType.SUPER_ADMIN);

    // ADMIN (created by Super Admin)
    const adminUser: StoredUser = {
      id: 'user-admin-001',
      username: 'admin_bravo',
      email: 'admin@bigdaddy.casino',
      passwordHash: bcrypt.hashSync('Admin@1234', salt),
      role: UserRole.ADMIN,
      parentId: superAdminUser.id,
      upiId: 'admin.bravo@oksbi',
      paymentAccountName: 'BigDaddy Admin Bravo Official',
      upiQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=admin.bravo@oksbi%26pn=BigDaddy%20Admin%20Bravo%26cu=INR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(adminUser.id, adminUser);
    this.createWalletForUser(adminUser.id, WalletType.ADMIN);

    // PLAYER 1 (created by Admin Bravo)
    const playerCharlie: StoredUser = {
      id: 'user-player-001',
      username: 'player_charlie',
      email: 'charlie@gmail.com',
      passwordHash: bcrypt.hashSync('Player@1234', salt),
      role: UserRole.PLAYER,
      parentId: adminUser.id,
      referralCode: 'BIGDADDY777',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(playerCharlie.id, playerCharlie);
    this.createWalletForUser(playerCharlie.id, WalletType.PLAYER);

    // Register Player Charlie's Referral Code
    this.referralCodes.set('BIGDADDY777', {
      code: 'BIGDADDY777',
      ownerUserId: playerCharlie.id,
      adminId: adminUser.id,
      active: true,
    });

    // Initial Transfers for Demo/Testing:
    // 1. Allocate 2,000,000 tokens from Treasury to Aviator Game Pool
    this.executeTransfer({
      sourceWalletId: SYSTEM_WALLETS.TREASURY,
      targetWalletId: SYSTEM_WALLETS.AVIATOR_POOL,
      amount: '2000000',
      type: TransactionType.POOL_ALLOCATION,
      idempotencyKey: 'SEED_POOL_AVIATOR',
      description: 'Initial seed allocation to Aviator Game Pool',
    });

    // Allocate 2,000,000 tokens from Treasury to European Roulette Game Pool
    this.executeTransfer({
      sourceWalletId: SYSTEM_WALLETS.TREASURY,
      targetWalletId: SYSTEM_WALLETS.ROULETTE_POOL,
      amount: '2000000',
      type: TransactionType.POOL_ALLOCATION,
      idempotencyKey: 'SEED_POOL_ROULETTE',
      description: 'Initial seed allocation to European Roulette Game Pool',
    });

    // 2. Transfer 5,000,000 tokens to SuperAdmin
    const saWallet = this.getWalletByUserId(superAdminUser.id)!;
    this.executeTransfer({
      sourceWalletId: SYSTEM_WALLETS.TREASURY,
      targetWalletId: saWallet.id,
      amount: '5000000',
      type: TransactionType.TREASURY_TO_ROLE,
      idempotencyKey: 'SEED_SA_ALPHA',
      description: 'Initial allocation to SuperAdmin Alpha',
    });

    // 3. Transfer 1,000,000 tokens from SuperAdmin to Admin
    const adminWallet = this.getWalletByUserId(adminUser.id)!;
    this.executeTransfer({
      sourceWalletId: saWallet.id,
      targetWalletId: adminWallet.id,
      amount: '1000000',
      type: TransactionType.ROLE_TO_ROLE,
      idempotencyKey: 'SEED_ADMIN_BRAVO',
      description: 'Initial allocation to Admin Bravo',
    });

    // 4. Transfer 10,000 tokens from Admin to Player Charlie
    const playerWallet = this.getWalletByUserId(playerCharlie.id)!;
    this.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '10000',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: 'SEED_PLAYER_CHARLIE',
      description: 'Initial welcome balance to Player Charlie',
    });

    // 5. Seed a pending token request for demonstration
    this.createTokenRequest({
      requesterId: playerCharlie.id,
      amount: '5000',
      note: 'Need chips for Aviator night session',
    });

    this.isInitialized = true;
    this.validateTokenSupplyInvariant();
  }

  // --- WALLET MANAGEMENT ---

  public createWalletForUser(userId: string, walletType: WalletType): Wallet {
    const existing = this.getWalletByUserId(userId);
    if (existing) return existing;

    const wallet: Wallet = {
      id: `wallet-user-${userId}`,
      userId,
      walletType,
      balance: '0',
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  public getWallet(walletId: string): Wallet | undefined {
    return this.wallets.get(walletId);
  }

  public getWalletByUserId(userId: string): Wallet | undefined {
    for (const w of this.wallets.values()) {
      if (w.userId === userId) return w;
    }
    return undefined;
  }

  public getTreasuryWallet(): Wallet {
    return this.wallets.get(SYSTEM_WALLETS.TREASURY)!;
  }

  public getEscrowWallet(): Wallet {
    return this.wallets.get(SYSTEM_WALLETS.BET_ESCROW)!;
  }

  public getGamePoolWallet(gameCode: string): Wallet | undefined {
    const game = Array.from(this.games.values()).find((g) => g.code === gameCode);
    if (!game) return undefined;
    return this.wallets.get(game.poolWalletId);
  }

  public getAllWallets(): Wallet[] {
    return Array.from(this.wallets.values());
  }

  // --- TOKEN SUPPLY INVARIANT VERIFICATION ---

  public validateTokenSupplyInvariant(): boolean {
    let totalSum = 0n;
    for (const wallet of this.wallets.values()) {
      const b = BigInt(wallet.balance);
      const r = BigInt(wallet.reservedBalance);
      if (b < 0n || r < 0n) {
        throw new Error(`Negative balance detected in wallet ${wallet.id}: balance=${b}, reserved=${r}`);
      }
      totalSum += b + r;
    }

    if (totalSum !== MAX_TOKEN_SUPPLY_BIGINT) {
      throw new Error(
        `CRITICAL INVARIANT VIOLATION: Total tokens in circulation (${totalSum.toString()}) does not match MAX_TOKEN_SUPPLY (${MAX_TOKEN_SUPPLY})`
      );
    }
    return true;
  }

  public getSupplySummary() {
    let circulatingRoles = 0n;
    let gamePools = 0n;
    let treasury = 0n;
    let escrow = 0n;

    for (const wallet of this.wallets.values()) {
      const totalInWallet = BigInt(wallet.balance) + BigInt(wallet.reservedBalance);
      if (wallet.walletType === WalletType.TREASURY) {
        treasury += totalInWallet;
      } else if (wallet.walletType === WalletType.GAME_POOL) {
        gamePools += totalInWallet;
      } else if (wallet.walletType === WalletType.ESCROW) {
        escrow += totalInWallet;
      } else {
        circulatingRoles += totalInWallet;
      }
    }

    const totalCalculated = treasury + gamePools + escrow + circulatingRoles;
    const isValid = totalCalculated === MAX_TOKEN_SUPPLY_BIGINT;

    return {
      maxSupply: MAX_TOKEN_SUPPLY,
      treasuryBalance: treasury.toString(),
      gamePoolsBalance: gamePools.toString(),
      roleWalletsBalance: circulatingRoles.toString(),
      escrowBalance: escrow.toString(),
      totalCalculated: totalCalculated.toString(),
      isSupplyValid: isValid,
    };
  }

  // --- ATOMIC TRANSFERS & DOUBLE-ENTRY LEDGER ---

  public executeTransfer(params: {
    sourceWalletId: string | null;
    targetWalletId: string;
    amount: string;
    type: TransactionType;
    idempotencyKey: string;
    description: string;
    metadata?: Record<string, any>;
  }): WalletTransaction {
    const { sourceWalletId, targetWalletId, amount, type, idempotencyKey, description, metadata } = params;

    // Idempotency check
    if (this.idempotencyKeys.has(idempotencyKey)) {
      const existing = Array.from(this.transactions.values()).find(
        (t) => t.idempotencyKey === idempotencyKey
      );
      if (existing) return existing;
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      throw new Error('Transfer amount must be strictly positive');
    }

    const targetWallet = this.wallets.get(targetWalletId);
    if (!targetWallet) {
      throw new Error(`Target wallet ${targetWalletId} does not exist`);
    }

    let sourceWallet: Wallet | undefined;
    if (sourceWalletId) {
      sourceWallet = this.wallets.get(sourceWalletId);
      if (!sourceWallet) {
        throw new Error(`Source wallet ${sourceWalletId} does not exist`);
      }
      const sourceBalance = BigInt(sourceWallet.balance);
      if (sourceBalance < amountBigInt) {
        throw new Error(`Insufficient funds: available ${sourceBalance}, required ${amountBigInt}`);
      }
    }

    // Atomic Execution
    const txId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    if (sourceWallet) {
      const newSourceBalance = (BigInt(sourceWallet.balance) - amountBigInt).toString();
      sourceWallet.balance = newSourceBalance;
      sourceWallet.updatedAt = now;

      // Double-entry DEBIT
      this.ledger.push({
        id: `led-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        transactionId: txId,
        walletId: sourceWallet.id,
        direction: LedgerDirection.DEBIT,
        amount,
        balanceAfter: newSourceBalance,
        description: `DEBIT: ${description}`,
        timestamp: now,
      });
    }

    const newTargetBalance = (BigInt(targetWallet.balance) + amountBigInt).toString();
    targetWallet.balance = newTargetBalance;
    targetWallet.updatedAt = now;

    // Double-entry CREDIT
    this.ledger.push({
      id: `led-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      transactionId: txId,
      walletId: targetWallet.id,
      direction: LedgerDirection.CREDIT,
      amount,
      balanceAfter: newTargetBalance,
      description: `CREDIT: ${description}`,
      timestamp: now,
    });

    const transaction: WalletTransaction = {
      id: txId,
      idempotencyKey,
      type,
      amount,
      sourceWalletId,
      targetWalletId,
      status: 'COMPLETED',
      metadata,
      createdAt: now,
    };

    this.transactions.set(txId, transaction);
    this.idempotencyKeys.add(idempotencyKey);

    // Update game pool balance cache if applicable
    if (targetWallet.walletType === WalletType.GAME_POOL && targetWallet.gameId) {
      const g = this.games.get(targetWallet.gameId);
      if (g) g.poolBalance = targetWallet.balance;
    }
    if (sourceWallet && sourceWallet.walletType === WalletType.GAME_POOL && sourceWallet.gameId) {
      const g = this.games.get(sourceWallet.gameId);
      if (g) g.poolBalance = sourceWallet.balance;
    }

    // Strictly verify invariant
    this.validateTokenSupplyInvariant();

    return transaction;
  }

  // --- USERS & RBAC ---

  public getUserById(id: string): StoredUser | undefined {
    return this.users.get(id);
  }

  public getUserByUsername(username: string): StoredUser | undefined {
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === username.toLowerCase()) return u;
    }
    return undefined;
  }

  public getUserByEmail(email: string): StoredUser | undefined {
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    return undefined;
  }

  public getAllUsers(): User[] {
    return Array.from(this.users.values()).map(({ passwordHash, ...rest }) => rest);
  }

  public createUser(params: {
    username: string;
    email: string;
    password: string;
    role: UserRole;
    parentId: string | null;
    referredBy?: string | null;
  }): User {
    if (this.getUserByUsername(params.username)) {
      throw new Error(`Username ${params.username} is already taken`);
    }
    if (this.getUserByEmail(params.email)) {
      throw new Error(`Email ${params.email} is already registered`);
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(params.password, salt);
    const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const referralCode =
      params.role === UserRole.PLAYER ? `BD${Math.random().toString(36).substring(2, 8).toUpperCase()}` : undefined;

    const storedUser: StoredUser = {
      id,
      username: params.username,
      email: params.email,
      passwordHash,
      role: params.role,
      parentId: params.parentId,
      referralCode,
      referredBy: params.referredBy || null,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(id, storedUser);

    // Create role wallet
    const walletType =
      params.role === UserRole.SUPER_ADMIN
        ? WalletType.SUPER_ADMIN
        : params.role === UserRole.ADMIN
        ? WalletType.ADMIN
        : WalletType.PLAYER;

    this.createWalletForUser(id, walletType);

    // If Player has a referral code, register it
    if (referralCode && params.parentId) {
      this.referralCodes.set(referralCode, {
        code: referralCode,
        ownerUserId: id,
        adminId: params.parentId,
        active: true,
      });
    }

    const { passwordHash: _, ...safeUser } = storedUser;
    return safeUser;
  }

  public updateUserPaymentDetails(
    userId: string,
    details: { upiId?: string; upiQrCode?: string; paymentAccountName?: string }
  ): StoredUser {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');
    if (details.upiId !== undefined) user.upiId = details.upiId;
    if (details.upiQrCode !== undefined) user.upiQrCode = details.upiQrCode;
    if (details.paymentAccountName !== undefined) user.paymentAccountName = details.paymentAccountName;
    user.updatedAt = new Date().toISOString();
    this.users.set(userId, user);
    return user;
  }

  // --- REFERRAL VALIDATION ---

  public getReferralCode(code: string) {
    return this.referralCodes.get(code.toUpperCase());
  }

  // --- HIERARCHY-BASED FILTERING ---

  public getAuthorizedUsers(requesterId: string): User[] {
    const requester = this.getUserById(requesterId);
    if (!requester) return [];

    if (requester.role === UserRole.OWNER) {
      return this.getAllUsers();
    }

    if (requester.role === UserRole.SUPER_ADMIN) {
      // Super Admin sees only Admins they created and Players created by those Admins
      const myAdmins = Array.from(this.users.values()).filter((u) => u.parentId === requester.id);
      const myAdminIds = new Set(myAdmins.map((a) => a.id));
      const myPlayers = Array.from(this.users.values()).filter(
        (u) => u.parentId && myAdminIds.has(u.parentId)
      );
      return [...myAdmins, ...myPlayers].map(({ passwordHash, ...rest }) => rest);
    }

    if (requester.role === UserRole.ADMIN) {
      // Admin sees ONLY their own direct players
      return Array.from(this.users.values())
        .filter((u) => u.parentId === requester.id)
        .map(({ passwordHash, ...rest }) => rest);
    }

    // Player sees only themselves
    const { passwordHash, ...safePlayer } = requester;
    return [safePlayer];
  }

  // --- TOKEN REQUESTS WORKFLOW ---

  public createTokenRequest(params: {
    requesterId: string;
    amount: string;
    note?: string;
  }): TokenRequest {
    const requester = this.getUserById(params.requesterId);
    if (!requester) throw new Error('Requester not found');

    let approverId: string;
    let approverUsername: string;

    if (requester.role === UserRole.PLAYER) {
      if (!requester.parentId) throw new Error('Player must have an assigned Admin');
      const admin = this.getUserById(requester.parentId);
      if (!admin || admin.role !== UserRole.ADMIN) {
        throw new Error('Assigned parent must be a valid Admin');
      }
      approverId = admin.id;
      approverUsername = admin.username;
    } else if (requester.role === UserRole.ADMIN) {
      if (!requester.parentId) throw new Error('Admin must have an assigned Super Admin');
      const superAdmin = this.getUserById(requester.parentId);
      if (!superAdmin || superAdmin.role !== UserRole.SUPER_ADMIN) {
        throw new Error('Assigned parent must be a valid Super Admin');
      }
      approverId = superAdmin.id;
      approverUsername = superAdmin.username;
    } else if (requester.role === UserRole.SUPER_ADMIN) {
      // Super Admin requests from Owner
      const owner = Array.from(this.users.values()).find((u) => u.role === UserRole.OWNER);
      if (!owner) throw new Error('System Owner not found');
      approverId = owner.id;
      approverUsername = owner.username;
    } else {
      throw new Error('Owner cannot request tokens from self');
    }

    const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const request: TokenRequest = {
      id,
      requesterId: requester.id,
      requesterUsername: requester.username,
      requesterRole: requester.role,
      approverId,
      approverUsername,
      amount: params.amount,
      status: TokenRequestStatus.PENDING,
      note: params.note,
      createdAt: new Date().toISOString(),
    };

    this.tokenRequests.set(id, request);
    return request;
  }

  public getAuthorizedTokenRequests(userId: string): TokenRequest[] {
    const user = this.getUserById(userId);
    if (!user) return [];

    const allRequests = Array.from(this.tokenRequests.values());

    if (user.role === UserRole.OWNER) {
      // Owner sees requests where they are approver or all system requests
      return allRequests;
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      // Super Admin sees requests they made (as requester) AND requests from their Admins (as approver)
      return allRequests.filter(
        (r) => r.approverId === user.id || r.requesterId === user.id
      );
    }

    if (user.role === UserRole.ADMIN) {
      // Admin sees requests they made (to SuperAdmin) AND requests from their Players (as approver)
      return allRequests.filter(
        (r) => r.approverId === user.id || r.requesterId === user.id
      );
    }

    // Player sees only their own requests
    return allRequests.filter((r) => r.requesterId === user.id);
  }

  public approveTokenRequest(params: {
    requestId: string;
    approverId: string;
    decisionNote?: string;
  }): { request: TokenRequest; transaction: WalletTransaction } {
    const request = this.tokenRequests.get(params.requestId);
    if (!request) throw new Error('Token request not found');

    if (request.status !== TokenRequestStatus.PENDING) {
      throw new Error(`Cannot approve request with status ${request.status}`);
    }

    const approver = this.getUserById(params.approverId);
    if (!approver) throw new Error('Approver not found');

    if (request.approverId !== approver.id && approver.role !== UserRole.OWNER) {
      throw new Error('Not authorized to approve this token request');
    }

    // Determine approver's wallet and requester's wallet
    let approverWallet: Wallet;
    if (approver.role === UserRole.OWNER) {
      approverWallet = this.getTreasuryWallet();
    } else {
      const w = this.getWalletByUserId(approver.id);
      if (!w) throw new Error('Approver wallet not found');
      approverWallet = w;
    }

    const requesterWallet = this.getWalletByUserId(request.requesterId);
    if (!requesterWallet) throw new Error('Requester wallet not found');

    // Atomic Transfer
    const idempotencyKey = `APPROVE_REQ_${request.id}`;
    let txType: TransactionType;
    if (approver.role === UserRole.OWNER) {
      txType = TransactionType.TREASURY_TO_ROLE;
    } else if (approver.role === UserRole.SUPER_ADMIN) {
      txType = TransactionType.ROLE_TO_ROLE;
    } else {
      txType = TransactionType.ROLE_TO_PLAYER;
    }

    const tx = this.executeTransfer({
      sourceWalletId: approverWallet.id,
      targetWalletId: requesterWallet.id,
      amount: request.amount,
      type: txType,
      idempotencyKey,
      description: `Token Request #${request.id} Approved by ${approver.username}`,
      metadata: { requestId: request.id, decisionNote: params.decisionNote },
    });

    request.status = TokenRequestStatus.APPROVED;
    request.decisionNote = params.decisionNote;
    request.transactionId = tx.id;
    request.resolvedAt = new Date().toISOString();

    return { request, transaction: tx };
  }

  public rejectTokenRequest(params: {
    requestId: string;
    approverId: string;
    decisionNote?: string;
  }): TokenRequest {
    const request = this.tokenRequests.get(params.requestId);
    if (!request) throw new Error('Token request not found');

    if (request.status !== TokenRequestStatus.PENDING) {
      throw new Error(`Cannot reject request with status ${request.status}`);
    }

    const approver = this.getUserById(params.approverId);
    if (!approver) throw new Error('Approver not found');

    if (request.approverId !== approver.id && approver.role !== UserRole.OWNER) {
      throw new Error('Not authorized to reject this token request');
    }

    request.status = TokenRequestStatus.REJECTED;
    request.decisionNote = params.decisionNote;
    request.resolvedAt = new Date().toISOString();

    return request;
  }

  // --- GAME POOL ALLOCATION (Owner only) ---

  public allocateTokensToGamePool(params: {
    ownerId: string;
    gameId: string;
    amount: string;
  }): WalletTransaction {
    const owner = this.getUserById(params.ownerId);
    if (!owner || owner.role !== UserRole.OWNER) {
      throw new Error('Only the Owner can allocate tokens to Game Pools');
    }

    const game = this.games.get(params.gameId);
    if (!game) throw new Error('Game not found');

    const tx = this.executeTransfer({
      sourceWalletId: SYSTEM_WALLETS.TREASURY,
      targetWalletId: game.poolWalletId,
      amount: params.amount,
      type: TransactionType.POOL_ALLOCATION,
      idempotencyKey: `ALLOC_POOL_${game.id}_${Date.now()}`,
      description: `Owner pool allocation to ${game.name}`,
      metadata: { gameId: game.id, ownerId: params.ownerId },
    });

    // Update game pool balance cache
    const poolWallet = this.getWallet(game.poolWalletId);
    if (poolWallet) {
      game.poolBalance = poolWallet.balance;
    }

    return tx;
  }

  public getGames(): GameInfo[] {
    return Array.from(this.games.values()).map((g) => {
      const poolWallet = this.getWallet(g.poolWalletId);
      return {
        ...g,
        poolBalance: poolWallet ? poolWallet.balance : '0',
      };
    });
  }

  // --- AUDIT LOGS ---

  public logAudit(params: {
    actorId: string;
    actorUsername: string;
    actorRole: UserRole;
    action: string;
    targetType: string;
    targetId: string;
    details: Record<string, any>;
  }): AuditLog {
    const log: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      actorId: params.actorId,
      actorUsername: params.actorUsername,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      details: params.details,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 500) {
      this.auditLogs.pop();
    }
    return log;
  }

  public getAuditLogs(limit = 100): AuditLog[] {
    return this.auditLogs.slice(0, limit);
  }

  public getLedgerEntries(walletId?: string, limit = 100): LedgerEntry[] {
    if (walletId) {
      return this.ledger
        .filter((l) => l.walletId === walletId)
        .slice(-limit)
        .reverse();
    }
    return this.ledger.slice(-limit).reverse();
  }
}

// Export singleton
export const db = new StorageEngine();
