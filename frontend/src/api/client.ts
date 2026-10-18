import {
  User,
  Wallet,
  UserRole,
  WalletType,
  TokenRequest,
  TokenRequestStatus,
  LedgerEntry,
  LedgerDirection,
  GameInfo,
  AppMode,
  AppConfigInfo,
  AviatorBet,
  BetStatus,
  AdminPaymentInfo,
} from '../../../shared/src/types';
import { GAMES_CATALOG, MAX_TOKEN_SUPPLY } from '../../../shared/src/constants';

const API_BASE = '/api';

// In-memory fallback state for standalone offline frontend preview
const mockState = {
  users: [
    {
      id: 'user-owner-001',
      username: 'owner',
      email: 'owner@bigdaddy.casino',
      role: UserRole.OWNER,
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'user-superadmin-001',
      username: 'superadmin_alpha',
      email: 'superadmin@bigdaddy.casino',
      role: UserRole.SUPER_ADMIN,
      parentId: 'user-owner-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'user-admin-001',
      username: 'admin_bravo',
      email: 'admin@bigdaddy.casino',
      role: UserRole.ADMIN,
      parentId: 'user-superadmin-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'user-player-001',
      username: 'player_charlie',
      email: 'charlie@gmail.com',
      role: UserRole.PLAYER,
      parentId: 'user-admin-001',
      referralCode: 'BIGDADDY777',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ] as User[],
  wallets: {
    'user-owner-001': {
      id: 'wallet-system-treasury',
      userId: null,
      walletType: WalletType.TREASURY,
      balance: '9993000000',
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    'user-superadmin-001': {
      id: 'wallet-user-superadmin-001',
      userId: 'user-superadmin-001',
      walletType: WalletType.SUPER_ADMIN,
      balance: '4000000',
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    'user-admin-001': {
      id: 'wallet-user-admin-001',
      userId: 'user-admin-001',
      walletType: WalletType.ADMIN,
      balance: '990000',
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    'user-player-001': {
      id: 'wallet-user-player-001',
      userId: 'user-player-001',
      walletType: WalletType.PLAYER,
      balance: '10000',
      reservedBalance: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  } as Record<string, Wallet>,
};

export class ApiClient {
  public static getToken(): string | null {
    return localStorage.getItem('bigdaddy_auth_token');
  }

  public static setToken(token: string) {
    localStorage.setItem('bigdaddy_auth_token', token);
  }

  public static clearToken() {
    localStorage.removeItem('bigdaddy_auth_token');
  }

  public static async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'API request failed');
      }

      return data;
    } catch (err: any) {
      // In development/preview standalone mode, if the backend server is unreachable,
      // failover gracefully to in-memory simulated mock responses so preview never breaks.
      if (err.name === 'TypeError' || err.message?.includes('fetch') || err.message?.includes('NetworkError')) {
        return this.handleFallbackMock(endpoint, options) as T;
      }
      throw err;
    }
  }

  private static handleFallbackMock(endpoint: string, options: RequestInit): any {
    console.warn(`[BigDaddy Preview] Backend unreachable, using isolated in-memory preview fallback for: ${endpoint}`);

    if (endpoint === '/config') {
      return {
        mode: AppMode.DEVELOPMENT_PREVIEW,
        isSimulated: true,
        databaseConnected: false,
        authProvider: 'SIMULATED_LOCAL',
        version: '1.0.0-preview',
      };
    }

    if (endpoint === '/auth/login') {
      const defaultUser = mockState.users[3]; // Player Charlie
      return {
        token: 'preview-simulated-token-player-001',
        user: defaultUser,
        wallet: mockState.wallets[defaultUser.id],
      };
    }

    if (endpoint === '/auth/me') {
      const defaultUser = mockState.users[3]; // Player Charlie
      return {
        user: defaultUser,
        wallet: mockState.wallets[defaultUser.id],
      };
    }

    if (endpoint === '/wallet/my-wallet') {
      return { wallet: mockState.wallets['user-player-001'] };
    }

    if (endpoint === '/wallet/summary') {
      return {
        maxSupply: MAX_TOKEN_SUPPLY,
        treasuryBalance: '9993000000',
        gamePoolsBalance: '2000000',
        roleWalletsBalance: '5000000',
        escrowBalance: '0',
        totalCalculated: MAX_TOKEN_SUPPLY,
        isSupplyValid: true,
      };
    }

    if (endpoint === '/games/list') {
      return {
        games: GAMES_CATALOG.map((g) => ({
          ...g,
          poolBalance: g.code === 'aviator' ? '2000000' : '0',
        })),
      };
    }

    if (endpoint === '/requests/list') {
      return { requests: [] };
    }

    if (endpoint === '/auth/admin-payment-info') {
      return {
        adminId: 'user-admin-001',
        adminUsername: 'admin_bravo',
        upiId: 'admin.bravo@oksbi',
        upiQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=admin.bravo@oksbi%26pn=BigDaddy%20Admin%20Bravo%26cu=INR',
        paymentAccountName: 'BigDaddy Admin Bravo Official',
      };
    }

    if (endpoint === '/wallet/ledger') {
      return { entries: [] };
    }

    if (endpoint === '/games/aviator/state') {
      return {
        round: {
          id: 'round-aviator-demo',
          roundNumber: 101,
          status: 'WAITING',
          multiplier: 1.0,
          startTime: Date.now() + 5000,
          crashedAt: null,
          betsCount: 0,
        },
        bets: [],
        history: [
          { roundNumber: 98, crashMultiplier: 2.14 },
          { roundNumber: 99, crashMultiplier: 5.62 },
          { roundNumber: 100, crashMultiplier: 1.12 },
        ],
      };
    }

    return {};
  }

  // Config Info
  public static async getConfig(): Promise<AppConfigInfo> {
    try {
      return await this.request<AppConfigInfo>('/config');
    } catch {
      return {
        mode: AppMode.DEVELOPMENT_PREVIEW,
        isSimulated: true,
        databaseConnected: false,
        authProvider: 'SIMULATED_LOCAL',
        version: '1.0.0-preview',
      };
    }
  }

  // Auth
  public static login(credentials: { username: string; password: string }) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  public static registerReferral(payload: {
    username: string;
    email: string;
    password: string;
    referralCode: string;
  }) {
    return this.request('/auth/register-referral', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static createUser(payload: {
    username: string;
    email: string;
    password: string;
    role: string;
    initialTokens?: string;
  }) {
    return this.request('/auth/create-user', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static getMe() {
    return this.request('/auth/me');
  }

  public static getUsers() {
    return this.request('/auth/users');
  }

  // Wallets & Ledger
  public static getMyWallet() {
    return this.request('/wallet/my-wallet');
  }

  public static getSupplySummary() {
    return this.request('/wallet/summary');
  }

  public static getLedger() {
    return this.request('/wallet/ledger');
  }

  public static transferTokens(payload: { recipientId: string; amount: string; note?: string }) {
    return this.request('/wallet/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Token Requests
  public static createTokenRequest(payload: { amount: string; note?: string }) {
    return this.request('/requests/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static getTokenRequests() {
    return this.request('/requests/list');
  }

  public static approveTokenRequest(id: string, payload?: { decisionNote?: string }) {
    return this.request(`/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  public static rejectTokenRequest(id: string, payload?: { decisionNote?: string }) {
    return this.request(`/requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  // Admin Payment Details (UPI & QR Photo)
  public static getAdminPaymentInfo(): Promise<AdminPaymentInfo> {
    return this.request('/auth/admin-payment-info');
  }

  public static updatePaymentDetails(payload: {
    upiId?: string;
    upiQrCode?: string;
    paymentAccountName?: string;
  }): Promise<{ message: string; user: User }> {
    return this.request('/auth/payment-details', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Games & Pools
  public static getGames() {
    return this.request('/games/list');
  }

  public static allocatePool(payload: { gameId: string; amount: string }) {
    return this.request('/games/allocate-pool', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Audit
  public static getAuditLogs() {
    return this.request('/audit/logs');
  }

  // Aviator
  public static getAviatorState() {
    return this.request('/games/aviator/state');
  }

  public static placeAviatorBet(payload: { amount: string; autoCashoutMultiplier?: number | null }) {
    return this.request('/games/aviator/bet', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static cashoutAviatorBet(payload: { betId: string }) {
    return this.request('/games/aviator/cashout', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // European Roulette
  public static getRouletteState() {
    return this.request('/games/roulette/state');
  }

  public static spinRoulette(payload: { bets: Array<{ type: string; numbers: number[]; amount: string }> }) {
    return this.request('/games/roulette/spin', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static placeRouletteBet(payload: { bets: Array<{ type: string; numbers: number[]; amount: string }> }) {
    return this.request('/games/roulette/bet', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Teen Patti Royal
  public static getTeenPattiState() {
    return this.request('/games/teen-patti/state');
  }

  public static startTeenPattiBoot(payload: { bootAmount: number }) {
    return this.request('/games/teen-patti/boot', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static performTeenPattiAction(payload: { action: 'see' | 'chaal' | 'blind' | 'pack' | 'showdown'; amount?: number }) {
    return this.request('/games/teen-patti/action', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Live Andar Bahar
  public static getAndarBaharState() {
    return this.request('/games/andar-bahar/state');
  }

  public static placeAndarBaharBet(payload: { bets: Array<{ type: string; amount: string }> }) {
    return this.request('/games/andar-bahar/bet', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Live Dragon Tiger
  public static getDragonTigerState() {
    return this.request('/games/dragon-tiger/state');
  }

  public static placeDragonTigerBet(payload: { bets: Array<{ type: string; amount: string }> }) {
    return this.request('/games/dragon-tiger/bet', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Provably Fair Dice
  public static getDiceState(userId?: string) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return this.request(`/games/dice/state${q}`);
  }

  public static rollDice(payload: {
    mode?: 'numbers' | 'slider';
    bets?: Array<{ type: string; amount: string }>;
    betAmount?: string;
    target?: number;
    condition?: 'over' | 'under';
    customClientSeed?: string;
  }) {
    return this.request('/games/dice/roll', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static placeDiceBet(payload: { bets: Array<{ type: string; amount: string }> }) {
    return this.request('/games/dice/bet', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public static verifyDiceRoll(payload: { serverSeed: string; clientSeed: string; nonce: number }) {
    return this.request('/games/dice/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
