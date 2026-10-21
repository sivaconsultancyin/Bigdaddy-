import { User, AppConfigInfo, AdminPaymentInfo } from '../../../shared/src/types';

const SUPABASE_API_BASE = 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api';
const API_BASE = import.meta.env.PROD ? SUPABASE_API_BASE : (import.meta.env.VITE_API_BASE_URL || '/api');

// Preserve the HTTP status for diagnostics without changing the user-facing error message.
export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

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

    // Never leave the login button spinning forever if the API or database stalls.
    const controller = new AbortController();
    // Render Free services may need more than 15 seconds to wake from sleep.
    // Allow time for cold start while backend/database limits remain enforced.
    const timeoutId = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        signal: options.signal ?? controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : null;

      if (!response.ok) {
        throw new ApiRequestError(response.status, data?.message || data?.error || `API request failed (${response.status})`);
      }

      return data as T;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('The server did not respond within 45 seconds. Please try again; if this continues, the server/database connection needs attention.');
      }
      if (error instanceof TypeError) {
        throw new Error('Could not reach the server. Check the connection and try again.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  // Config Info
  public static getConfig(): Promise<AppConfigInfo> {
    // Configuration must come from the authoritative backend. Never fabricate a
    // local preview configuration when the backend is unavailable.
    return this.request<AppConfigInfo>('/config');
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
  public static createTokenRequest(payload: { amount: string; note?: string; proofScreenshot?: string }) {
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

  public static async allocatePool(payload: { gameId?: string; gameCode?: string; amount: string }) {
    const gameCode = payload.gameCode || 'aviator';
    const allocation = await this.request<{ transactionId: string; poolBalance: string; gameCode: string }>('/wallet/game-pool', {
      method: 'POST',
      headers: { 'Idempotency-Key': `POOL_ALLOCATION_${gameCode}_${crypto.randomUUID()}` },
      body: JSON.stringify({ amount: payload.amount, gameCode }),
    });

    // Activate only after the Treasury-to-pool transfer succeeds.
    const activation = await this.request<{ status: string; poolBalance: string; gameCode?: string }>(`/games/${encodeURIComponent(gameCode)}/activate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    return { ...allocation, ...activation };
  }

  // Audit
  public static getAuditLogs() {
    return this.request('/audit/logs');
  }

  // Aviator
  public static getAviatorState() {
    return this.request('/games/aviator/state');
  }

  public static placeAviatorBet(payload: { amount: string; autoCashoutMultiplier?: number | null }, idempotencyKey: string = 'aviator-bet-' + crypto.randomUUID()) {
    return this.request('/games/aviator/bet', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
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
      headers: { 'Idempotency-Key': 'roulette-spin-' + crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
  }

  public static placeRouletteBet(payload: { bets: Array<{ type: string; numbers: number[]; amount: string }> }) {
    return this.request('/games/roulette/bet', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'roulette-bet-' + crypto.randomUUID() },
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
      headers: { 'Idempotency-Key': 'andar-bahar-' + crypto.randomUUID() },
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
      headers: { 'Idempotency-Key': 'dragon-tiger-' + crypto.randomUUID() },
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
      headers: { 'Idempotency-Key': 'dice-roll-' + crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
  }

  public static placeDiceBet(payload: { bets: Array<{ type: string; amount: string }> }) {
    return this.request('/games/dice/bet', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'dice-bet-' + crypto.randomUUID() },
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
