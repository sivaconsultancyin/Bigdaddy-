import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
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

  const simIntervalRef = useRef<any>(null);
  const productionResultIdsRef = useRef<Record<string, string>>({});
  const otherGamesPollAtRef = useRef(0);
  const lastSuccessfulRoundAtRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const lastHealthCheckAtRef = useRef(0);

  const connect = () => {
    if (typeof window === 'undefined') return;
    // Every game state update comes from the backend's durable, authoritative API.
    // Do not connect to legacy WebSocket handlers backed by in-memory game engines.
    startProductionPolling();
  };

  const startProductionPolling = () => {
    if (simIntervalRef.current) return;
    let inFlight = false;
    disposedRef.current = false;
    const apiBase = import.meta.env.PROD ? 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api' : (import.meta.env.VITE_API_BASE_URL || '/api');
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
        if (pollOtherGames) otherGamesPollAtRef.current = Date.now();
        const gamePaths = [
          ['aviator', '/games/aviator/state'],
          ...(pollOtherGames ? [
            ['roulette', '/games/roulette/state'],
            ['dice', '/games/dice/state'],
            ['dragonTiger', '/games/dragon-tiger/state'],
            ['andarBahar', '/games/andar-bahar/state'],
          ] as const : []),
        ] as const;
        // Bound every poll so one stalled game endpoint cannot permanently block
        // all live-state updates (or leave the global connection badge Offline).
        const results = await Promise.all(gamePaths.map(async ([key, path]) => {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), key === 'aviator' ? 7000 : 5000);
          try {
            const response = await fetch(apiBase + path, {
              headers: { Accept: 'application/json' },
              signal: controller.signal,
            });
            if (!response.ok) return { key, data: null, error: `HTTP_${response.status}` };
            const data = await response.json();
            return { key, data, error: null };
          } catch (error) {
            return { key, data: null, error: error instanceof Error ? (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR') : 'NETWORK_ERROR' };
          } finally {
            window.clearTimeout(timeoutId);
          }
        }));
        const aviatorResult = results.find(({ key }) => key === 'aviator');
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
                startTime: round.startedAt ? new Date(round.startedAt).getTime() : undefined,
                crashMultiplier: round.crashMultiplier ?? undefined,
              });
              // While running, the display is animated locally at frame rate. Keep
              // server-provided values for non-running states so crash/result freezes
              // immediately when the authoritative API reports it.
              if (round.status !== 'RUNNING') setMultiplier(Number(round.multiplier ?? round.crashMultiplier ?? 1));
              refreshWalletForResult('aviator', round);
            }
            if (Array.isArray(data.history)) setRecentHistory(data.history.map((item: any) => ({ roundNumber: Number(item.roundNumber), crashMultiplier: Number(item.crashMultiplier) })));
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
      }
    };
    void poll();
    simIntervalRef.current = setInterval(() => { void poll(); }, 1000);
  };

  useEffect(() => {
    connect();
    return () => {
      disposedRef.current = true;
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, []);

  // Smooth the visible multiplier between 500ms API polls. This is display-only:
  // backend state remains authoritative for bets, cashouts, crashes and settlement.
  // The curve matches production.engine.ts and is evaluated every animation frame.
  useEffect(() => {
    if (roundState.status !== 'RUNNING' || !roundState.startTime) return;
    let frameId = 0;
    let lastRendered = 1;
    const animate = () => {
      const elapsedSeconds = Math.max(0, (Date.now() - roundState.startTime!) / 1000);
      const nextMultiplier = Math.floor(Math.exp(0.06 * Math.pow(elapsedSeconds, 1.15)) * 100) / 100;
      // Never move the displayed number backwards during a running round.
      lastRendered = Math.max(lastRendered, nextMultiplier);
      setMultiplier(lastRendered);
      frameId = window.requestAnimationFrame(animate);
    };
    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [roundState.status, roundState.startTime, roundState.id]);

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
