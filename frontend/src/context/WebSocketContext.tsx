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
  const [roundState, setRoundState] = useState<{
    id?: string;
    roundNumber?: number;
    status: 'WAITING' | 'RUNNING' | 'CRASHED' | 'SETTLED';
    startTime?: number;
    crashMultiplier?: number;
  }>({ status: 'WAITING' });
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

  const simIntervalRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);\n  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const productionResultIdsRef = useRef<Record<string, string>>({});
  const otherGamesPollAtRef = useRef(0);
  // Only poll secondary games that the authoritative API marks ACTIVE. This avoids
  // hammering empty round tables for games that are still COMING_SOON.
  const activeGameKeysRef = useRef<Set<string>>(new Set(['aviator']));
  const lastGameListRefreshAtRef = useRef(0);
  const gameListRefreshInFlightRef = useRef(false);
  const lastSuccessfulRoundAtRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const lastHealthCheckAtRef = useRef(0);

  const connect = () => {
    if (typeof window === 'undefined') return;
    // Broadcast delivers round lifecycle transitions; the authenticated API remains
    // authoritative for the current multiplier, history, and user-specific state.
    startProductionPolling();
  };

  const startProductionPolling = () => {
    if (simIntervalRef.current) return;
    let inFlight = false;
    let realtimeConnected = false;
    let stopped = false;
    disposedRef.current = false;
    const apiBase = import.meta.env.PROD ? 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api' : (import.meta.env.VITE_API_BASE_URL || '/api');
    const scheduleNextPoll = () => {
      if (stopped || disposedRef.current) return;
      const running = roundState.status === 'RUNNING';
      // Realtime handles lifecycle transitions. Poll less often for the live
      // multiplier and retain a quicker fallback when the socket is disconnected.
      const delay = realtimeConnected
        ? (running ? 1500 : 5000)
        : (running ? 1000 : 2500);
      simIntervalRef.current = window.setTimeout(() => { void poll(); }, delay);
    };
    const refreshWalletForResult = (key: string, round: any) => {
      if (!round?.id || !['RESULT', 'SETTLED', 'CRASHED'].includes(round.status)) return;
      const resultKey = `${round.id}:${round.status}`;
      if (productionResultIdsRef.current[key] === resultKey) return;
      productionResultIdsRef.current[key] = resultKey;
      if (userRef.current) refreshWallet();
    };
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const now = Date.now();
        // Health is checked independently from game state. A healthy process with a
        // stalled game endpoint is reported as degraded, not mistaken for a healthy round feed.
        if (now - lastHealthCheckAtRef.current >= 10000) {
          lastHealthCheckAtRef.current = now;
          const healthStartedAt = performance.now();
          const healthController = new AbortController();
          const healthTimeout = window.setTimeout(() => healthController.abort(), 8000);
          void fetch(apiBase.replace(/\/$/, '') + '/health', {
            headers: { Accept: 'application/json' },
            signal: healthController.signal,
          }).then(async (response) => {
            const health = await response.json().catch(() => null);
            if (disposedRef.current) return;
            // Any HTTP response proves the API process is reachable. Only mark it
            // Online when its database is connected and production mode is ready.
            const databaseConnected = health?.databaseConnected === true;
            const productionReady = health?.mode !== 'production' || health?.productionFinancialApisEnabled === true;
            setApiHealth(response.ok && databaseConnected && productionReady ? 'online' : 'degraded');
            setApiLastCheckedAt(Date.now());
            setApiResponseTimeMs(Math.round(performance.now() - healthStartedAt));
          }).catch(() => {
            if (!disposedRef.current) {
              setApiHealth('offline');
              setApiLastCheckedAt(Date.now());
              setApiResponseTimeMs(null);
            }
          }).finally(() => window.clearTimeout(healthTimeout));
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
              const listTimeout = window.setTimeout(() => listController.abort(), 5000);
              void fetch(apiBase + '/games/list', {
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
                signal: listController.signal,
              }).then(async (response) => {
                if (!response.ok) return;
                const payload = await response.json().catch(() => null);
                if (!Array.isArray(payload?.games)) return;
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
                gameListRefreshInFlightRef.current = false;
              });
            }
          }
        }
        const activeGameKeys = activeGameKeysRef.current;
        const gamePaths = [
          ['aviator', '/games/aviator/state'],
          ...(pollOtherGames ? [
            ...(activeGameKeys.has('roulette') ? [['roulette', '/games/roulette/state'] as const] : []),
            ...(activeGameKeys.has('dice') ? [['dice', '/games/dice/state'] as const] : []),
            ...(activeGameKeys.has('dragonTiger') ? [['dragonTiger', '/games/dragon-tiger/state'] as const] : []),
            ...(activeGameKeys.has('andarBahar') ? [['andarBahar', '/games/andar-bahar/state'] as const] : []),
          ] : []),
        ] as const;
        // Bound every poll so one stalled game endpoint cannot permanently block
        // all live-state updates (or leave the global connection badge Offline).
        const results = await Promise.all(gamePaths.map(async ([key, path]) => {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), key === 'aviator' ? 7000 : 5000);
          try {
            // Game-state endpoints are authenticated. Read the current token on
            // every poll so login/logout changes are reflected without remounting.
            const token = ApiClient.getToken();
            if (!token) return { key, data: null, error: 'AUTH_REQUIRED', receivedAt: null };

            const response = await fetch(apiBase + path, {
              cache: 'no-store',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
              },
              signal: controller.signal,
            });
            if (!response.ok) return { key, data: null, error: `HTTP_${response.status}`, receivedAt: null };
            const data = await response.json();
            return { key, data, error: null, receivedAt: Date.now() };
          } catch (error) {
            return { key, data: null, error: error instanceof Error ? (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR') : 'NETWORK_ERROR', receivedAt: null };
          } finally {
            window.clearTimeout(timeoutId);
          }
        }));
        const aviatorResult = results.find(({ key }) => key === 'aviator');
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
        scheduleNextPoll();
      }
    };

    // The database broadcasts only safe public round lifecycle fields on this
    // public topic. Never subscribe to or broadcast wallet, bet, or seed secrets.
    const channel = supabaseRealtime
      .channel('aviator:rounds', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'round_state_changed' }, () => {
        // Fetch the authoritative API snapshot after each lifecycle event. It
        // includes computed multiplier/history and respects normal auth checks.
        if (simIntervalRef.current) window.clearTimeout(simIntervalRef.current);
        void poll();
      })
      .subscribe((status) => {
        realtimeConnected = status === 'SUBSCRIBED';
        if (realtimeConnected) {
          if (simIntervalRef.current) window.clearTimeout(simIntervalRef.current);
          void poll();
        }
      });
    realtimeChannelRef.current = channel;
    void poll();
  };

  useEffect(() => {
    connect();
    return () => {
      disposedRef.current = true;
      if (simIntervalRef.current) window.clearTimeout(simIntervalRef.current);
      if (realtimeChannelRef.current) {
        void supabaseRealtime.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, []);

  // Smoothly interpolate only toward values confirmed by the API. Never extrapolate
  // beyond the latest authoritative multiplier, so the UI cannot pass the crash point.
  useEffect(() => {
    const terminal = roundState.status === 'CRASHED' || roundState.status === 'SETTLED' || roundState.status === 'WAITING';
    if (terminal) {
      displayedMultiplierRef.current = authoritativeMultiplier;
      setMultiplier(authoritativeMultiplier);
      return;
    }

    const startValue = displayedMultiplierRef.current;
    const targetValue = Math.max(startValue, authoritativeMultiplier);
    if (targetValue <= startValue) return;

    let frame = 0;
    let startTime: number | null = null;
    const durationMs = 450;
    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.min(targetValue, startValue + (targetValue - startValue) * eased);
      displayedMultiplierRef.current = nextValue;
      setMultiplier(nextValue);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [authoritativeMultiplier, roundState.status]);

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
