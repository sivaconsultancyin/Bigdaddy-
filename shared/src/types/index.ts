export enum UserRole {
  OWNER = 'OWNER',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  PLAYER = 'PLAYER',
}

export enum WalletType {
  TREASURY = 'TREASURY',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  PLAYER = 'PLAYER',
  GAME_POOL = 'GAME_POOL',
  ESCROW = 'ESCROW',
}

export enum TokenRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum TransactionType {
  SYSTEM_INITIALIZATION = 'SYSTEM_INITIALIZATION',
  TREASURY_TO_ROLE = 'TREASURY_TO_ROLE',
  ROLE_TO_ROLE = 'ROLE_TO_ROLE',
  ROLE_TO_PLAYER = 'ROLE_TO_PLAYER',
  TOKEN_REQUEST_APPROVAL = 'TOKEN_REQUEST_APPROVAL',
  POOL_ALLOCATION = 'POOL_ALLOCATION',
  BET_ESCROW_LOCK = 'BET_ESCROW_LOCK',
  BET_ESCROW_REFUND = 'BET_ESCROW_REFUND',
  BET_WIN_PAYOUT = 'BET_WIN_PAYOUT',
  BET_LOSS_TREASURY = 'BET_LOSS_TREASURY',
}

export enum LedgerDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum GameStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  COMING_SOON = 'COMING_SOON',
}

export enum RoundStatus {
  WAITING = 'WAITING',
  RUNNING = 'RUNNING',
  CRASHED = 'CRASHED',
  SETTLED = 'SETTLED',
}

export enum BetStatus {
  PENDING = 'PENDING',
  WON = 'WON',
  LOST = 'LOST',
  CANCELLED = 'CANCELLED',
}

export enum AppMode {
  DEVELOPMENT_PREVIEW = 'DEVELOPMENT_PREVIEW',
  PRODUCTION = 'PRODUCTION',
}

export interface AppConfigInfo {
  mode: AppMode;
  isSimulated: boolean;
  databaseConnected: boolean;
  authProvider: 'SIMULATED_LOCAL' | 'PRODUCTION_SUPABASE_POSTGRES';
  version: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  parentId: string | null; // Hierarchy: Owner -> SuperAdmin -> Admin -> Player
  referralCode?: string;
  referredBy?: string | null;
  upiId?: string;
  upiQrCode?: string; // QR code image (data URL or external URL)
  paymentAccountName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPaymentInfo {
  adminId: string | null;
  adminUsername: string;
  upiId: string;
  upiQrCode: string | null;
  paymentAccountName?: string;
}

export interface Wallet {
  id: string;
  userId: string | null;
  walletType: WalletType;
  gameId?: string | null; // For GAME_POOL wallets
  balance: string; // Token amounts represented as string to avoid 64-bit float loss
  reservedBalance: string; // For escrow/pending operations
  createdAt: string;
  updatedAt: string;
}

export interface TokenSupplyInfo {
  maxSupply: string; // "10000000000"
  circulating: string;
  treasuryBalance: string;
  gamePoolsBalance: string;
  roleWalletsBalance: string;
  escrowBalance: string;
  isSupplyValid: boolean;
}

export interface TokenRequest {
  id: string;
  requesterId: string;
  requesterUsername: string;
  requesterRole: UserRole;
  approverId: string;
  approverUsername: string;
  amount: string; // BIGINT string
  status: TokenRequestStatus;
  note?: string;
  proofScreenshot?: string; // Base64 data URL or image URL of deposit receipt
  decisionNote?: string;
  transactionId?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  walletId: string;
  direction: LedgerDirection;
  amount: string;
  balanceAfter: string;
  description: string;
  timestamp: string;
}

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  amount: string;
  sourceWalletId: string | null;
  targetWalletId: string | null;
  idempotencyKey: string;
  status: 'COMPLETED' | 'FAILED';
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface GameInfo {
  id: string;
  name: string;
  code: string;
  status: GameStatus;
  poolWalletId: string;
  poolBalance: string;
  minBet: string;
  maxBet: string;
  description: string;
  iconName: string;
  route: string;
}

export interface AviatorRound {
  id: string;
  roundNumber: number;
  status: RoundStatus;
  multiplier: number;
  crashMultiplier: number;
  startTime: number;
  crashedAt: number | null;
  totalBetsCount: number;
  totalBetAmount: string;
}

export interface AviatorBet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  betAmount: string;
  autoCashoutMultiplier: number | null;
  cashedOutMultiplier: number | null;
  winAmount: string | null;
  status: BetStatus;
  createdAt: string;
}

export enum RouletteRoundStatus {
  BETTING = 'BETTING',
  SPINNING = 'SPINNING',
  RESULT = 'RESULT',
}

export interface RouletteRoundBet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  type: string;
  numbers: number[];
  amount: string;
  won?: boolean;
  payout?: string;
  profit?: string;
  createdAt: string;
}

export interface RouletteRound {
  id: string;
  roundNumber: number;
  status: RouletteRoundStatus;
  bettingEndsAt: number;
  spinEndsAt: number | null;
  winningNumber: number | null;
  color: 'red' | 'black' | 'green' | null;
  totalBetsCount: number;
  totalBetAmount: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorUsername: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, any>;
  timestamp: string;
}

export enum AndarBaharRoundStatus {
  BETTING = 'BETTING',
  DEALING = 'DEALING',
  RESULT = 'RESULT',
}

export interface AndarBaharRound {
  id: string;
  roundNumber: number;
  status: AndarBaharRoundStatus;
  jokerCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number } | null;
  bettingEndsAt: number;
  dealCards: Array<{ side: 'andar' | 'bahar'; card: { suit: 'S' | 'H' | 'D' | 'C'; rank: number } }>;
  winningSide: 'andar' | 'bahar' | null;
  winningCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number } | null;
  totalCardsDealt: number;
  firstSide: 'andar' | 'bahar';
  totalBetsCount: number;
  totalBetAmount: string;
  andarBetAmount: string;
  baharBetAmount: string;
}

export interface AndarBaharRoundBet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  type: string;
  amount: string;
  won?: boolean;
  payout?: string;
  profit?: string;
  createdAt: string;
}

export interface AndarBaharHistoryItem {
  roundNumber: number;
  jokerCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number };
  winningSide: 'andar' | 'bahar';
  winningCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number };
  totalCards: number;
  timestamp: string;
}

export enum DragonTigerRoundStatus {
  BETTING = 'BETTING',
  REVEALING = 'REVEALING',
  RESULT = 'RESULT',
}

export interface DragonTigerRound {
  id: string;
  roundNumber: number;
  status: DragonTigerRoundStatus;
  bettingEndsAt: number;
  dragonCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number } | null;
  tigerCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number } | null;
  winner: 'dragon' | 'tiger' | 'tie' | 'suited_tie' | null;
  totalBetsCount: number;
  totalBetAmount: string;
  dragonBetAmount: string;
  tigerBetAmount: string;
  tieBetAmount: string;
}

export interface DragonTigerRoundBet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  type: string;
  amount: string;
  won?: boolean;
  payout?: string;
  profit?: string;
  createdAt: string;
}

export interface DragonTigerHistoryItem {
  roundNumber: number;
  dragonCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number };
  tigerCard: { suit: 'S' | 'H' | 'D' | 'C'; rank: number };
  winner: 'dragon' | 'tiger' | 'tie' | 'suited_tie';
  timestamp: string;
}

export interface DiceRollResult {
  id: string;
  userId: string;
  username: string;
  mode?: 'numbers' | 'slider';
  target: number;
  condition: 'over' | 'under';
  roll: number;
  rolledNumber?: number; // 1 to 10
  selectedNumbers?: number[]; // [1, 2, ... 10]
  bets?: Array<{ type: string; amount: string; won?: boolean; payout?: string }>;
  winChance: number;
  multiplier: number;
  betAmount: string;
  won: boolean;
  payout: string;
  profit: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt: string;
}

export enum DiceRoundStatus {
  BETTING = 'BETTING',
  ROLLING = 'ROLLING',
  RESULT = 'RESULT',
}

export interface DiceRound {
  id: string;
  roundNumber: number;
  status: DiceRoundStatus;
  bettingEndsAt: number;
  rolledNumber: number | null; // 1 to 10
  totalBetsCount: number;
  totalBetAmount: string;
  numberBetsAmount: Record<string, string>;
}

export interface DiceRoundBet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  type: string; // '1'..'10', 'small', 'big', 'even', 'odd'
  amount: string;
  won?: boolean;
  payout?: string;
  profit?: string;
  createdAt: string;
}

export interface DiceHistoryItem {
  roundNumber: number;
  rolledNumber: number;
  timestamp: string;
}


