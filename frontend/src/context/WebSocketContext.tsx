import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { ApiClient } from '../api/client';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

const SUPABASE_REALTIME_URL = 'https://nzvpuoeibqrpcltrszvr.supabase.co';
const SUPABASE_REALTIME_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_3StQxumtXcMHvM9i3bTldw_e1toL-FR';
const supabaseRealtime = createClient(SUPABASE_REALTIME_URL, SUPABASE_REALTIME_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});
import {
  AndarBaharRound,
  AndarBaharHistoryItem,
  AndarBaharRoundBet,
  AndarBaharRoundStatus,
  DragonTigerRound,
  DragonTigerHistoryItem,
  DragonTigerRoundBet,
  DragonTigerRoundStatus,
  DiceRound,
  DiceHistoryItem,
  DiceRoundBet,
  DiceRoundStatus,
} from '../../../shared/src/types';

export interface RouletteLiveState {
  id: string;
  roundNumber: number;
  status: 'BETTING' | 'SPINNING' | 'RESULT';
  bettingEndsAt: number;
  spinEndsAt: number | null;
  winningNumber: number | null;
  color: 'red' | 'black' | 'green' | null;
  totalBetsCount: number;
  totalBetAmount: string;
  recentWinners?: Array<{ username: string; totalPayout: string; netProfit: string }>;
}

export interface RouletteBetFeedItem {
  id: string;
  username: string;
  type: string;
  amount: string;
  numbers?: number[];
}

interface WebSocketContextType {
  isConnected: boolean;
  apiHealth: 'checking' | 'online' | 'degraded' | 'offline';
  apiLastCheckedAt: number | null;
  apiResponseTimeMs: number | null;
  roundDataStatus: 'waiting' | 'fresh' | 'stale' | 'offline';
  lastSuccessfulRoundAt: number | null;
  lastRoundError: string | null;
  isSimulatedFallback: boolean;
  multiplier: number;
  roundState: {
    id?: string;
    roundNumber?: number;
    status: 'WAITING' | 'RUNNING' | 'CRASHED' | 'SETTLED';
    startTime?: number;
    crashMultiplier?: number;
  };
  recentHistory: Array<{ roundNumber: number; crashMultiplier: number }>;
  // European Roulette shared live multiplayer state
  rouletteRound: RouletteLiveState;
  rouletteHistory: Array<{ number: number; color: 'red' | 'black' | 'green'; timestamp?: string }>;
  addRouletteHistoryItem: (item: { number: number; color: 'red' | 'black' | 'green'; timestamp?: string }) => void;
  rouletteLiveBets: RouletteBetFeedItem[];
  // Andar Bahar shared synchronized multiplayer state
  andarBaharRound: AndarBaharRound;
  andarBaharHistory: AndarBaharHistoryItem[];
  andarBaharLiveBets: AndarBaharRoundBet[];
  // Dragon Tiger shared synchronized multiplayer state
  dragonTigerRound: DragonTigerRound;
  dragonTigerHistory: DragonTigerHistoryItem[];
  dragonTigerLiveBets: DragonTigerRoundBet[];
  // Lucky 10 Dice shared synchronized multiplayer state
  diceRound: DiceRound;
  diceHistory: DiceHistoryItem[];
  diceLiveBets: DiceRoundBet[];
  lastEvent: { event: string; data: any } | null;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, refreshWallet } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const [isConnected, setIsConnected] = useState(false);
  const [apiHealth, setApiHealth] = useState<'checking' | 'online' | 'degraded' | 'offline'>('checking');
  const [apiLastCheckedAt, setApiLastCheckedAt] = useState<number | null>(null);
  const [apiResponseTimeMs, setApiResponseTimeMs] = useState<number | null>(null);
  const [roundDataStatus, setRoundDataStatus] = useState<'waiting' | 'fresh' | 'stale' | 'offline'>('waiting');
  const [lastSuccessfulRoundAt, setLastSuccessfulRoundAt] = useState<number | null>(null);
  const [lastRoundError, setLastRoundError] = useState<string | null>(null);
  const [isSimulatedFallback, setIsSimulatedFallback] = useState(false);
  const [multiplier, setMultiplier] = useState(1.0);
  const [authoritativeMultiplier, setAuthoritativeMultiplier] = useState(1.0);
  const displayedMultiplierRef = useRef(1.0);
  const lastAviatorRequestStartRef = useRef<number | null>(null);
  const lastAuthoritativeMultiplierRef = useRef<{ value: number; at: number; roundId: string | null } | null>(null);
  const isRealtimeConnectedRef = useRef(false);

  const animatedRoundIdRef = useRef<string | undefined>(undefined);
  const [roundState, setRoundState] = useState<{
    id?: string;
    roundNumber?: number;
    status: 'WAITING' | 'RUNNING' | 'CRASHED' | 'SETTLED';
    startTime?: number;
    crashMultiplier?: number;
  }>({ status: 'WAITING' });
  const roundStateRef = useRef(roundState);
  roundStateRef.current = roundState;
  const [recentHistory, setRecentHistory] = useState<Array<{ roundNumber: number; crashMultiplier: number }>>([]);

  // European Roulette initial state
  const [rouletteRound, setRouletteRound] = useState<RouletteLiveState>({
    id: '',
    roundNumber: 0,
    status: 'BETTING',
    bettingEndsAt: 0,
    spinEndsAt: null,
    winningNumber: null,
    color: null,
    totalBetsCount: 0,
    totalBetAmount: '0',
  });

  const [rouletteHistory, setRouletteHistory] = useState<Array<{ number: number; color: 'red' | 'black' | 'green'; timestamp?: string }>>([]);

  const [rouletteLiveBets, setRouletteLiveBets] = useState<RouletteBetFeedItem[]>([]);

  // Andar Bahar initial synchronized multiplayer state
  const [andarBaharRound, setAndarBaharRound] = useState<AndarBaharRound>({
    id: '',
    roundNumber: 0,
    status: AndarBaharRoundStatus.BETTING,
    jokerCard: null,
    bettingEndsAt: 0,
    dealCards: [],
    winningSide: null,
    winningCard: null,
    totalCardsDealt: 0,
    firstSide: 'bahar',
    totalBetsCount: 0,
    totalBetAmount: '0',
    andarBetAmount: '0',
    baharBetAmount: '0',
  });

  const [andarBaharHistory, setAndarBaharHistory] = useState<AndarBaharHistoryItem[]>([]);

  const [andarBaharLiveBets, setAndarBaharLiveBets] = useState<AndarBaharRoundBet[]>([]);

  // Dragon Tiger initial synchronized multiplayer state
  const [dragonTigerRound, setDragonTigerRound] = useState<DragonTigerRound>({
    id: '',
    roundNumber: 0,
    status: DragonTigerRoundStatus.BETTING,
    bettingEndsAt: 0,
    dragonCard: null,
    tigerCard: null,
    winner: null,
    totalBetsCount: 0,
    totalBetAmount: '0',
    dragonBetAmount: '0',
    tigerBetAmount: '0',
    tieBetAmount: '0',
  });

  const [dragonTigerHistory, setDragonTigerHistory] = useState<DragonTigerHistoryItem[]>([]);

  const [dragonTigerLiveBets, setDragonTigerLiveBets] = useState<DragonTigerRoundBet[]>([]);

  // Lucky 10 Dice initial synchronized multiplayer state
  const [diceRound, setDiceRound] = useState<DiceRound>({
    id: '',
    roundNumber: 0,
    status: DiceRoundStatus.BETTING,
    bettingEndsAt: 0,
    rolledNumber: null,
    totalBetsCount: 0,
    totalBetAmount: '0',
    numberBetsAmount: {},
  });

  const [diceHistory, setDiceHistory] = useState<DiceHistoryItem[]>([]);

  const [diceLiveBets, setDiceLiveBets] = useState<DiceRoundBet[]>([]);
  const [lastEvent, setLastEvent] = useState<{ event: string; data: any } | null>(null);

  const addRouletteHistoryItem = useCallback((item: { number: number; color: 'red' | 'black' | 'green'; timestamp?: string }) => {
    setRouletteHistory((prev) => {
      // Prevent duplicate if already the very first item
      if (prev.length > 0 && prev[0].number === item.number) {
        return prev;
      }
      return [item, ...prev.slice(0, 24)];
    });
  }, []);

  const simIntervalRef = useRef<number | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const productionResultIdsRef = useRef<Record<string, string>>({});
  const otherGamesPollAtRef = useRef(0);
  // Only poll secondary games that the authoritative API marks ACTIVE. This avoids
  // hammering empty round tables for games that are still COMING_SOON.
  const activeGameKeysRef = useRef<Set<string>>(new Set(['aviator']));
  const lastGameListRefreshAtRef = useRef(0);
  const gameListRefreshInFlightRef = useRef(false);
  const lastSuccessfulRoundAtRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const pollingActiveRef = useRef(false);
  const stopPollingRef = useRef<(() => void) | null>(null);
  const pollAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const lastHealthCheckAtRef = useRef(0);

  const connect = () => {
    if (typeof window === 'undefined') return;
    // Broadcast delivers round lifecycle transitions; the authenticated API remains
    // authoritative for the current multiplier, history, and user-specific state.
    startProductionPolling();
  };

  const startProductionPolling = () => {
    if (pollingActiveRef.current) return;
    pollingActiveRef.current = true;
    let inFlight = false;
    let rerunRequested = false;
    let stopped = false;
    // Secondary game requests run independently and never gate Aviator state updates.
    let secondaryFetchInFlight = false;
    let pendingSecondaryResults: Array<{ key: string; data: any; error: string | null; receivedAt: number | null }> = [];
    stopPollingRef.current = () => {
      stopped = true;
      pollingActiveRef.current = false;
    };
    disposedRef.current = false;
    const apiBase = import.meta.env.PROD ? 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api' : (import.meta.env.VITE_API_BASE_URL || '/api');
    const aviatorApiBase = import.meta.env.VITE_AVIATOR_API_BASE_URL || 'https://yrleubhpiqejfvingqfj.supabase.co/functions/v1/aviator-api';
    const aviatorApiKey = import.meta.env.VITE_AVIATOR_SUPABASE_PUBLISHABLE_KEY || '';
    const scheduleNextPoll = (pollStartedAt: number) => {
      if (stopped || disposedRef.current) return;
      const running = roundStateRef.current.status === 'RUNNING';
      // Realtime is a fast path, not a substitute for polling. Poll every second
      // outside RUNNING so WAITING -> RUNNING is detected even if a broadcast is lost.
      // Keep the 200ms authoritative polling cadence while RUNNING.
      const intervalMs = running ? 200 : 1000;
      // Measure from request start, not request completion, while never overlapping
      // requests. If the API is slower than the target cadence, poll again immediately.
      const delay = Math.max(0, intervalMs - (Date.now() - pollStartedAt));
      simIntervalRef.current = window.setTimeout(() => {
        simIntervalRef.current = null;
        void poll();
      }, delay);
    };
    const refreshWalletForResult = (key: string, round: any) => {
      if (!round?.id || !['RESULT', 'SETTLED', 'CRASHED'].includes(round.status)) return;
      const resultKey = `${round.id}:${round.status}`;
      if (productionResultIdsRef.current[key] === resultKey) return;
      productionResultIdsRef.current[key] = resultKey;
      if (userRef.current) refreshWallet();
    };
    const poll = async () => {
      // Keep only one state request active at a time. Overlapping responses can
      // arrive out of order and make the displayed multiplier appear to pause or jump.
      if (inFlight) {
        rerunRequested = true;
        return;
      }
      inFlight = true;
      const pollStartedAt = Date.now();
      try {
        const now = Date.now();
        // Health is checked independently from game state. A healthy process with a
        // stalled game endpoint is reported as degraded, not mistaken for a healthy round feed.
        if (now - lastHealthCheckAtRef.current >= 10000) {
          lastHealthCheckAtRef.current = now;
          const healthStartedAt = performance.now();
          const healthController = new AbortController();
          pollAbortControllersRef.current.add(healthController);
          const healthTimeout = window.setTimeout(() => healthController.abort(), 8000);
          void fetch(apiBase.replace(/\/$/, '') + '/health', {
            headers: { Accept: 'application/json' },
            signal: healthController.signal,
          }).then(async (response) => {
            const health = await response.json().catch(() => null);
            if (stopped || disposedRef.current) return;
            // Any HTTP response proves the API process is reachable. Only mark it
            // Online when its database is connected and production mode is ready.
            const databaseConnected = health?.databaseConnected === true;
            const productionReady = health?.mode !== 'production' || health?.productionFinancialApisEnabled === true;
            setApiHealth(response.ok && databaseConnected && productionReady ? 'online' : 'degraded');
            setApiLastCheckedAt(Date.now());
            setApiResponseTimeMs(Math.round(performance.now() - healthStartedAt));
          }).catch(() => {
            if (!stopped && !disposedRef.current) {
              setApiHealth('offline');
              setApiLastCheckedAt(Date.now());
              setApiResponseTimeMs(null);
            }
          }).finally(() => {
            window.clearTimeout(healthTimeout);
            pollAbortControllersRef.current.delete(healthController);
          });
        }
        const pollOtherGames = now - otherGamesPollAtRef.current >= 1500;
        if (pollOtherGames) {
          otherGamesPollAtRef.current = now;
          // Refresh the active-game inventory in the background; never block Aviator
          // state polling while the inventory endpoint is slow or unavailable.
          if (now - lastGameListRefreshAtRef.current >= 30000 && !gameListRefreshInFlightRef.current) {
            lastGameListRefreshAtRef.current = now;
            const token = window.localStorage.getItem('bigdaddy_auth_token');
            if (token) {
              gameListRefreshInFlightRef.current = true;
              const listController = new AbortController();
              pollAbortControllersRef.current.add(listController);
              const listTimeout = window.setTimeout(() => listController.abort(), 5000);
              void fetch(apiBase + '/games/list', {
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
                signal: listController.signal,
              }).then(async (response) => {
                if (!response.ok || stopped || disposedRef.current) return;
                const payload = await response.json().catch(() => null);
                if (stopped || disposedRef.current || !Array.isArray(payload?.games)) return;
                const keyByCode: Record<string, string> = {
                  aviator: 'aviator',
                  roulette: 'roulette',
                  dice: 'dice',
                  dragon_tiger: 'dragonTiger',
                  andar_bahar: 'andarBahar',
                };
                const active = new Set<string>();
                for (const game of payload.games) {
                  if (game?.status === 'ACTIVE' && typeof game.code === 'string' && keyByCode[game.code]) {
                    active.add(keyByCode[game.code]);
                  }
                }
                activeGameKeysRef.current = active;
              }).catch(() => {
                // Keep the last known inventory on transient failures.
              }).finally(() => {
                window.clearTimeout(listTimeout);
                pollAbortControllersRef.current.delete(listController);
                gameListRefreshInFlightRef.current = false;
              });
            }
          }
        }
        const activeGameKeys = activeGameKeysRef.current;
        const secondaryPaths = pollOtherGames ? [
          ...(activeGameKeys.has('roulette') ? [['roulette', '/games/roulette/state'] as const] : []),
          ...(activeGameKeys.has('dice') ? [['dice', '/games/dice/state'] as const] : []),
          ...(activeGameKeys.has('dragonTiger') ? [['dragonTiger', '/games/dragon-tiger/state'] as const] : []),
          ...(activeGameKeys.has('andarBahar') ? [['andarBahar', '/games/andar-bahar/state'] as const] : []),
        ] : [];
        const fetchGameState = async ([key, path]: readonly [string, string]) => {
          const controller = new AbortController();
          pollAbortControllersRef.current.add(controller);
          const timeoutId = window.setTimeout(() => controller.abort(), key === 'aviator' ? 7000 : 5000);
          const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `aviator-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const sentAt = new Date().toISOString();
          const started = performance.now();
          const previousStart = key === 'aviator' ? lastAviatorRequestStartRef.current : null;
          if (key === 'aviator') lastAviatorRequestStartRef.current = started;
          const emitDiagnostic = (detail: Record<string, unknown>) => {
            try {
              const event = { requestId, path, key, sentAt, ...detail };
              const storageKey = 'bigdaddy_aviator_diagnostics_v1';
              const prior = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
              const entries = Array.isArray(prior) ? prior : [];
              window.localStorage.setItem(storageKey, JSON.stringify([event, ...entries].slice(0, 40)));
              window.dispatchEvent(new CustomEvent('bigdaddy:aviator-diagnostic', { detail: event }));
            } catch { /* diagnostics must never break gameplay */ }
          };
          try {
            const token = ApiClient.getToken();
            if (!token) {
              emitDiagnostic({ outcome: 'error', error: 'AUTH_REQUIRED', httpStatus: null, latencyMs: Math.round(performance.now() - started), pollingGapMs: previousStart === null ? null : Math.round(started - previousStart), receivedAt: null });
              return { key, data: null, error: 'AUTH_REQUIRED', receivedAt: null };
            }
            const requestBase = key === 'aviator' ? aviatorApiBase : apiBase;
            const requestHeaders: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
            if (key === 'aviator' && aviatorApiKey) requestHeaders.apikey = aviatorApiKey;
            const response = await fetch(requestBase + path + (key === 'aviator' ? `?request_id=${encodeURIComponent(requestId)}` : ''), {
              cache: 'no-store',
              headers: requestHeaders,
              signal: controller.signal,
            });
            const receivedAt = new Date().toISOString();
            const latencyMs = Math.round(performance.now() - started);
            const backendDuration = Number(response.headers.get('x-backend-duration-ms'));
            const backendReceivedAt = response.headers.get('x-backend-received-at');
            const backendCompletedAt = response.headers.get('x-backend-completed-at');
            const diagnostic = { outcome: response.ok ? 'success' : 'error', httpStatus: response.status, receivedAt, latencyMs, pollingGapMs: previousStart === null ? null : Math.round(started - previousStart), backendDurationMs: Number.isFinite(backendDuration) && response.headers.has('x-backend-duration-ms') ? backendDuration : null, backendReceivedAt, backendCompletedAt, realtimeConnected: isRealtimeConnectedRef.current };
            if (!response.ok) {
              emitDiagnostic({ ...diagnostic, error: `HTTP_${response.status}` });
              return { key, data: null, error: `HTTP_${response.status}`, receivedAt: null };
            }
            const data = await response.json();
            if (key === 'aviator') {
              const nextMultiplier = Number(data?.round?.multiplier ?? data?.round?.crashMultiplier);
              const nextRoundId = typeof data?.round?.id === 'string' ? data.round.id : null;
              const priorMultiplier = lastAuthoritativeMultiplierRef.current;
              const validMultiplier = Number.isFinite(nextMultiplier) && nextMultiplier > 0;
              const sameRound = Boolean(priorMultiplier && priorMultiplier.roundId === nextRoundId);
              const multiplierChanged = validMultiplier && (!sameRound || priorMultiplier?.value !== nextMultiplier);
              const multiplierUpdateGapMs = multiplierChanged && sameRound && priorMultiplier?.at
                ? Math.round(Date.now() - priorMultiplier.at)
                : null;
              if (multiplierChanged) lastAuthoritativeMultiplierRef.current = { value: nextMultiplier, at: Date.now(), roundId: nextRoundId };
              emitDiagnostic({ ...diagnostic, multiplier: validMultiplier ? nextMultiplier : null, previousMultiplier: priorMultiplier?.value ?? null, multiplierUpdateGapMs, roundStatus: data?.round?.status ?? null, roundId: nextRoundId });
            }
            return { key, data, error: null, receivedAt: Date.now() };
          } catch (error) {
            const errorCode = error instanceof Error ? (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR') : 'NETWORK_ERROR';
            emitDiagnostic({ outcome: 'error', error: errorCode, httpStatus: null, receivedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), pollingGapMs: previousStart === null ? null : Math.round(started - previousStart), realtimeConnected: isRealtimeConnectedRef.current });
            return { key, data: null, error: errorCode, receivedAt: null };
          } finally {
            window.clearTimeout(timeoutId);
            pollAbortControllersRef.current.delete(controller);
          }
        };

        // Kick off secondary-game polling in the background. Its slow responses
        // are buffered for the next processing pass and cannot delay Aviator.
        if (secondaryPaths.length > 0 && !secondaryFetchInFlight) {
          secondaryFetchInFlight = true;
          void Promise.all(secondaryPaths.map((path) => fetchGameState(path))).then((secondaryResults) => {
            if (!stopped && !disposedRef.current) pendingSecondaryResults = secondaryResults;
          }).finally(() => {
            secondaryFetchInFlight = false;
          });
        }

        // Await only Aviator's authoritative state in the live multiplier loop.
        const aviatorResult = await fetchGameState(['aviator', '/games/aviator/state']);
        const results = [aviatorResult, ...pendingSecondaryResults];
        pendingSecondaryResults = [];

        // Align local animation to the API clock so a device clock skew cannot move the displayed crash point.
        const serverTimeMs = aviatorResult?.data?.serverTime ? Date.parse(aviatorResult.data.serverTime) : NaN;
        const serverClockOffsetMs = Number.isFinite(serverTimeMs) && Number.isFinite(aviatorResult?.receivedAt)
          ? serverTimeMs - Number(aviatorResult?.receivedAt)
          : 0;
        const validAviatorState = Boolean(aviatorResult?.data && typeof aviatorResult.data === 'object' &&
          (aviatorResult.data.round || Array.isArray(aviatorResult.data.history)));
        if (validAviatorState) {
          const successAt = Date.now();
          lastSuccessfulRoundAtRef.current = successAt;
          setLastSuccessfulRoundAt(successAt);
          setRoundDataStatus('fresh');
          setLastRoundError(null);
          setIsConnected(true);
        } else {
          const error = aviatorResult?.error || 'INVALID_ROUND_RESPONSE';
          setLastRoundError(error);
          const lastSuccess = lastSuccessfulRoundAtRef.current;
          const age = lastSuccess === null ? Infinity : Date.now() - lastSuccess;
          setRoundDataStatus(age <= 15000 ? 'stale' : 'offline');
          setIsConnected(age <= 15000);
        }
        for (const { key, data } of results) {
          if (!data) continue;
          if (key === 'aviator') {
            if (data.round) {
              const round = data.round;
              setRoundState({
                id: round.id,
                roundNumber: round.roundNumber,
                status: round.status,
                startTime: round.startedAt ? new Date(round.startedAt).getTime() - serverClockOffsetMs : undefined,
                crashMultiplier: round.crashMultiplier ?? undefined,
              });
              // The API computes the live multiplier and caps it at the committed
              // crash point. Never extrapolate on the client: doing so can show 1.50x
              // even when the authoritative round crashed at 1.14x.
              const authoritativeMultiplier = ['CRASHED', 'SETTLED'].includes(round.status)
                ? round.crashMultiplier ?? round.multiplier ?? 1
                : round.multiplier ?? 1;
              setAuthoritativeMultiplier(Number(authoritativeMultiplier));
              refreshWalletForResult('aviator', round);
            }
            if (Array.isArray(data.history)) {
              // History is durable: merge by round number so a transient empty/stale
              // payload cannot erase a crash already shown to the player.
              setRecentHistory((previous) => {
                const byRound = new Map(previous.map((item) => [item.roundNumber, item]));
                for (const item of data.history) {
                  const roundNumber = Number(item?.roundNumber);
                  const crashMultiplier = Number(item?.crashMultiplier);
                  if (Number.isFinite(roundNumber) && roundNumber > 0 && Number.isFinite(crashMultiplier) && crashMultiplier > 0) {
                    byRound.set(roundNumber, { roundNumber, crashMultiplier });
                  }
                }
                return [...byRound.values()]
                  .sort((left, right) => right.roundNumber - left.roundNumber)
                  .slice(0, 20);
              });
            }
            setLastEvent({ event: 'production:crash_state', data });
          } else if (key === 'roulette') {
            if (data.round) {
              setRouletteRound(data.round);
              if (data.round.status === 'RESULT' && productionResultIdsRef.current.roulette !== `${data.round.id}:${data.round.status}`) {
                setLastEvent({ event: 'roulette:round_result', data: {
                  round: data.round,
                  winningNumber: data.round.winningNumber,
                  color: data.round.color,
                  history: data.history,
                } });
              }
              refreshWalletForResult('roulette', data.round);
            }
            if (Array.isArray(data.history)) {
              setRouletteHistory(data.history.map((item: any) => ({
                number: Number(item.result?.number ?? item.number),
                color: (item.result?.color ?? item.color ?? 'black'),
                timestamp: item.timestamp,
              })));
            }
            if (Array.isArray(data.bets)) setRouletteLiveBets(data.bets.map((b: any) => ({
              id: b.id, username: b.username || 'Player', type: b.type,
              amount: String(b.amount), numbers: b.selection?.numbers,
            })));
          } else if (key === 'dice') {
            if (data.round) {
              setDiceRound(data.round as any);
              refreshWalletForResult('dice', data.round);
            }
            if (Array.isArray(data.history)) setDiceHistory(data.history.map((h: any) => ({
              ...h, rolledNumber: h.result?.number ?? h.rolledNumber,
            })) as any);
            if (Array.isArray(data.allBets || data.bets)) setDiceLiveBets((data.allBets || data.bets) as any);
          } else if (key === 'dragonTiger') {
            if (data.round) {
              setDragonTigerRound(data.round as any);
              refreshWalletForResult('dragonTiger', data.round);
            }
            if (Array.isArray(data.history)) setDragonTigerHistory(data.history.map((h: any) => ({
              ...h, dragonCard: h.result?.dragonCard, tigerCard: h.result?.tigerCard,
              winner: h.result?.winner,
            })) as any);
            if (Array.isArray(data.bets)) setDragonTigerLiveBets(data.bets as any);
          } else if (key === 'andarBahar') {
            if (data.round) {
              setAndarBaharRound(data.round as any);
              refreshWalletForResult('andarBahar', data.round);
            }
            if (Array.isArray(data.history)) setAndarBaharHistory(data.history.map((h: any) => ({
              ...h,
              jokerCard: h.result?.jokerCard,
              winningSide: h.result?.winner,
              winningCard: h.result?.dealCards?.[Math.max(0, (h.result?.dealCards?.length || 1) - 1)]?.card,
              totalCards: h.result?.totalCardsDealt,
              timestamp: h.timestamp,
            })) as any);
            if (Array.isArray(data.bets)) setAndarBaharLiveBets(data.bets as any);
          }
        }
        // The connection badge is based on valid Aviator round-feed freshness;
        // secondary game endpoints do not change this status.
        setIsSimulatedFallback(false);
      } catch {
        const lastSuccess = lastSuccessfulRoundAtRef.current;
        const stillWithinGrace = lastSuccess !== null && Date.now() - lastSuccess <= 15000;
        setIsConnected(stillWithinGrace);
        setRoundDataStatus(stillWithinGrace ? 'stale' : 'offline');
        setLastRoundError('POLL_ERROR');
        setIsSimulatedFallback(false);
      } finally {
        inFlight = false;
        if (stopped || disposedRef.current) return;
        if (rerunRequested) {
          rerunRequested = false;
          simIntervalRef.current = window.setTimeout(() => {
            simIntervalRef.current = null;
            void poll();
          }, 0);
          return;
        }
        scheduleNextPoll(pollStartedAt);
      }
    };

    // The database broadcasts only safe public round lifecycle fields on this
    // public topic. Never subscribe to or broadcast wallet, bet, or seed secrets.
    const channel = supabaseRealtime
      .channel('aviator:rounds', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'round_state_changed' }, () => {
        if (stopped || disposedRef.current) return;
        // Coalesce broadcasts while a request is running; fetch one fresh snapshot
        // immediately after it completes instead of overlapping requests or losing the event.
        if (simIntervalRef.current !== null) {
          window.clearTimeout(simIntervalRef.current);
          simIntervalRef.current = null;
        }
        if (inFlight) {
          rerunRequested = true;
          return;
        }
        void poll();
      })
      .subscribe((status) => {
        if (stopped || disposedRef.current) return;
        isRealtimeConnectedRef.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          if (simIntervalRef.current !== null) {
            window.clearTimeout(simIntervalRef.current);
            simIntervalRef.current = null;
          }
          if (inFlight) rerunRequested = true;
          else void poll();
        }
      });
    realtimeChannelRef.current = channel;
    void poll();
  };

  useEffect(() => {
    connect();
    return () => {
      disposedRef.current = true;
      stopPollingRef.current?.();
      stopPollingRef.current = null;
      if (simIntervalRef.current !== null) {
        window.clearTimeout(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      for (const controller of pollAbortControllersRef.current) controller.abort();
      pollAbortControllersRef.current.clear();
      if (realtimeChannelRef.current) {
        void supabaseRealtime.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, []);

  // Keep the latest server-confirmed target in a ref. The animation loop is
  // created once per RUNNING round and is not restarted for each API response.
  // This prevents frame resets/stutter when multiplier updates arrive irregularly.
  const authoritativeMultiplierRef = useRef(authoritativeMultiplier);
  authoritativeMultiplierRef.current = authoritativeMultiplier;

  useEffect(() => {
    // A new round is a hard animation boundary. Never carry the previous round's
    // displayed multiplier forward, even when the status remains RUNNING.
    if (roundState.id !== animatedRoundIdRef.current) {
      animatedRoundIdRef.current = roundState.id;
      displayedMultiplierRef.current = 1.0;
      setMultiplier(1.0);
    }

    const terminal = roundState.status === 'CRASHED' || roundState.status === 'SETTLED' || roundState.status === 'WAITING';
    if (terminal) {
      displayedMultiplierRef.current = authoritativeMultiplierRef.current;
      setMultiplier(authoritativeMultiplierRef.current);
      return;
    }

    let frame = 0;
    let previousTimestamp: number | null = null;
    const animate = (timestamp: number) => {
      if (previousTimestamp === null) previousTimestamp = timestamp;
      const deltaMs = Math.min(50, Math.max(0, timestamp - previousTimestamp));
      previousTimestamp = timestamp;

      const current = displayedMultiplierRef.current;
      const target = Math.max(current, authoritativeMultiplierRef.current);
      const difference = target - current;
      // Frame-rate-independent easing toward the latest authoritative value.
      // The value can approach the target but never exceed it or predict a crash.
      const blend = 1 - Math.exp(-deltaMs / 65);
      const nextValue = difference <= 0.0005 ? target : Math.min(target, current + difference * blend);
      if (nextValue !== current) {
        displayedMultiplierRef.current = nextValue;
        setMultiplier(nextValue);
      }
      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [roundState.id, roundState.status]);

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        apiHealth,
        apiLastCheckedAt,
        apiResponseTimeMs,
        roundDataStatus,
        lastSuccessfulRoundAt,
        lastRoundError,
        isSimulatedFallback,
        multiplier,
        roundState,
        recentHistory,
        rouletteRound,
        rouletteHistory,
        addRouletteHistoryItem,
        rouletteLiveBets,
        andarBaharRound,
        andarBaharHistory,
        andarBaharLiveBets,
        dragonTigerRound,
        dragonTigerHistory,
        dragonTigerLiveBets,
        diceRound,
        diceHistory,
        diceLiveBets,
        lastEvent,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
