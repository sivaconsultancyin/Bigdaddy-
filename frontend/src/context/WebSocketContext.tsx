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

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const simIntervalRef = useRef<any>(null);

  const connect = () => {
    if (typeof window === 'undefined') return;
    if (import.meta.env.PROD) {
      startProductionPolling();
      return;
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsSimulatedFallback(false);
        if (simIntervalRef.current) {
          clearInterval(simIntervalRef.current);
          simIntervalRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setLastEvent(parsed);

          if (parsed.event === 'connected') {
            if (parsed.data.round) setRoundState(parsed.data.round);
            if (parsed.data.history) setRecentHistory(parsed.data.history);
            if (parsed.data.rouletteRound) setRouletteRound(parsed.data.rouletteRound);
            if (parsed.data.rouletteHistory) setRouletteHistory(parsed.data.rouletteHistory);
            if (parsed.data.rouletteBets) setRouletteLiveBets(parsed.data.rouletteBets);
            if (parsed.data.andarBaharRound) setAndarBaharRound(parsed.data.andarBaharRound);
            if (parsed.data.andarBaharHistory) setAndarBaharHistory(parsed.data.andarBaharHistory);
            if (parsed.data.andarBaharBets) setAndarBaharLiveBets(parsed.data.andarBaharBets);
            if (parsed.data.dragonTigerRound) setDragonTigerRound(parsed.data.dragonTigerRound);
            if (parsed.data.dragonTigerHistory) setDragonTigerHistory(parsed.data.dragonTigerHistory);
            if (parsed.data.dragonTigerBets) setDragonTigerLiveBets(parsed.data.dragonTigerBets);
            if (parsed.data.diceRound) setDiceRound(parsed.data.diceRound);
            if (parsed.data.diceHistory) setDiceHistory(parsed.data.diceHistory);
            if (parsed.data.diceBets) setDiceLiveBets(parsed.data.diceBets);
          }
          // Aviator events
          else if (parsed.event === 'aviator:tick') {
            setMultiplier(parsed.data.multiplier);
          } else if (parsed.event === 'aviator:round_waiting') {
            setRoundState(parsed.data.round);
            setMultiplier(1.0);
            if (parsed.data.history) setRecentHistory(parsed.data.history);
            if (userRef.current) refreshWallet();
          } else if (parsed.event === 'aviator:round_started') {
            setRoundState(parsed.data.round);
            setMultiplier(1.0);
          } else if (parsed.event === 'aviator:crashed') {
            setRoundState((prev) => ({
              ...prev,
              status: 'CRASHED',
              crashMultiplier: parsed.data.crashMultiplier,
            }));
            setMultiplier(parsed.data.crashMultiplier);
            if (userRef.current) refreshWallet();
          } else if (parsed.event === 'aviator:bet_cashed_out') {
            if (userRef.current) refreshWallet();
          }
          // European Roulette Multiplayer Synchronized Events
          else if (parsed.event === 'roulette:round_betting') {
            if (parsed.data.round) setRouletteRound(parsed.data.round);
            if (parsed.data.history) setRouletteHistory(parsed.data.history);
            setRouletteLiveBets([]);
            if (userRef.current) refreshWallet();
          } else if (parsed.event === 'roulette:bet_placed') {
            if (parsed.data.bet) {
              setRouletteLiveBets((prev) => [parsed.data.bet, ...prev.slice(0, 19)]);
            }
            setRouletteRound((prev) => ({
              ...prev,
              totalBetsCount: parsed.data.totalBetsCount ?? prev.totalBetsCount + 1,
              totalBetAmount: parsed.data.totalBetAmount ?? prev.totalBetAmount,
            }));
          } else if (parsed.event === 'roulette:round_spinning') {
            if (parsed.data.round) {
              setRouletteRound(parsed.data.round);
            } else {
              setRouletteRound((prev) => ({
                ...prev,
                status: 'SPINNING',
                winningNumber: parsed.data.winningNumber,
                color: parsed.data.color,
                spinEndsAt: parsed.data.spinEndsAt,
              }));
            }
          } else if (parsed.event === 'roulette:round_result') {
            if (parsed.data.round) setRouletteRound(parsed.data.round);
            if (parsed.data.history) setRouletteHistory(parsed.data.history);
            if (userRef.current) refreshWallet();
          }
          // Andar Bahar Synchronized Multiplayer Events
          else if (parsed.event === 'andar_bahar:round_betting') {
            if (parsed.data.round) setAndarBaharRound(parsed.data.round);
            if (parsed.data.history) setAndarBaharHistory(parsed.data.history);
            setAndarBaharLiveBets([]);
            if (userRef.current) refreshWallet();
          } else if (parsed.event === 'andar_bahar:round_dealing') {
            if (parsed.data.round) setAndarBaharRound(parsed.data.round);
          } else if (parsed.event === 'andar_bahar:card_dealt') {
            setAndarBaharRound((prev) => {
              return {
                ...prev,
                status: AndarBaharRoundStatus.DEALING,
                dealCards: [...prev.dealCards, parsed.data.item],
                totalCardsDealt: parsed.data.totalDealt,
              };
            });
          } else if (parsed.event === 'andar_bahar:bet_placed') {
            if (parsed.data.bets && Array.isArray(parsed.data.bets)) {
              setAndarBaharLiveBets((prev) => [...parsed.data.bets, ...prev.slice(0, 19)]);
            }
            if (parsed.data.round) {
              setAndarBaharRound((prev) => ({
                ...prev,
                totalBetsCount: parsed.data.round.totalBetsCount,
                totalBetAmount: parsed.data.round.totalBetAmount,
                andarBetAmount: parsed.data.round.andarBetAmount,
                baharBetAmount: parsed.data.round.baharBetAmount,
              }));
            }
          } else if (parsed.event === 'andar_bahar:round_result') {
            if (parsed.data.round) setAndarBaharRound(parsed.data.round);
            if (parsed.data.history) setAndarBaharHistory(parsed.data.history);
            if (userRef.current) refreshWallet();
          }
          // Dragon Tiger Synchronized Multiplayer Events
          else if (parsed.event === 'dragon_tiger:round_betting') {
            if (parsed.data.round) setDragonTigerRound(parsed.data.round);
            if (parsed.data.history) setDragonTigerHistory(parsed.data.history);
            setDragonTigerLiveBets([]);
            if (userRef.current) refreshWallet();
          } else if (parsed.event === 'dragon_tiger:round_revealing') {
            if (parsed.data.round) setDragonTigerRound(parsed.data.round);
          } else if (parsed.event === 'dragon_tiger:bet_placed') {
            if (parsed.data.bets && Array.isArray(parsed.data.bets)) {
              setDragonTigerLiveBets((prev) => [...parsed.data.bets, ...prev.slice(0, 19)]);
            }
            if (parsed.data.round) {
              setDragonTigerRound((prev) => ({
                ...prev,
                totalBetsCount: parsed.data.round.totalBetsCount,
                totalBetAmount: parsed.data.round.totalBetAmount,
                dragonBetAmount: parsed.data.round.dragonBetAmount,
                tigerBetAmount: parsed.data.round.tigerBetAmount,
                tieBetAmount: parsed.data.round.tieBetAmount,
              }));
            }
          } else if (parsed.event === 'dragon_tiger:round_result') {
            if (parsed.data.round) setDragonTigerRound(parsed.data.round);
            if (parsed.data.history) setDragonTigerHistory(parsed.data.history);
            if (userRef.current) refreshWallet();
          }
          // Lucky 10 Dice Synchronized Multiplayer Events
          else if (parsed.event === 'dice:round_betting') {
            if (parsed.data.round) setDiceRound(parsed.data.round);
            if (parsed.data.history) setDiceHistory(parsed.data.history);
            setDiceLiveBets([]);
            if (userRef.current) refreshWallet();
          } else if (parsed.event === 'dice:round_rolling') {
            if (parsed.data.round) setDiceRound(parsed.data.round);
          } else if (parsed.event === 'dice:bet_placed') {
            if (parsed.data.bets && Array.isArray(parsed.data.bets)) {
              setDiceLiveBets((prev) => [...parsed.data.bets, ...prev.slice(0, 19)]);
            }
            if (parsed.data.round) {
              setDiceRound((prev) => ({
                ...prev,
                totalBetsCount: parsed.data.round.totalBetsCount,
                totalBetAmount: parsed.data.round.totalBetAmount,
                numberBetsAmount: parsed.data.round.numberBetsAmount,
              }));
            }
          } else if (parsed.event === 'dice:round_result') {
            if (parsed.data.round) setDiceRound(parsed.data.round);
            if (parsed.data.history) setDiceHistory(parsed.data.history);
            if (userRef.current) refreshWallet();
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        socketRef.current = null;
        reconnectTimeoutRef.current = setTimeout(connect, 4000);
      };

      ws.onerror = () => {
        setIsConnected(false);
      };
    } catch (e) {
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connect, 4000);
    }
  };

  const startProductionPolling = () => {
    if (simIntervalRef.current) return;
    let inFlight = false;
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://bigdaddy-backend.onrender.com/api';
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(apiBase + '/games/aviator/state', { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Crash state API unavailable');
        const data = await response.json();
        setIsConnected(true);
        setIsSimulatedFallback(false);
        if (data.round) {
          const round = data.round;
          setRoundState({
            id: round.id,
            roundNumber: round.roundNumber,
            status: round.status,
            startTime: round.startedAt ? new Date(round.startedAt).getTime() : undefined,
            crashMultiplier: round.crashMultiplier ?? undefined,
          });
          setMultiplier(Number(round.multiplier || 1));
        }
        if (Array.isArray(data.history)) setRecentHistory(data.history.map((item: any) => ({ roundNumber: Number(item.roundNumber), crashMultiplier: Number(item.crashMultiplier) })));
        setLastEvent({ event: 'production:crash_state', data });
      } catch {
        setIsConnected(false);
        setIsSimulatedFallback(false);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    simIntervalRef.current = setInterval(() => { void poll(); }, 500);
  };

  useEffect(() => {
    connect();

    const pingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ action: 'ping' }));
      }
    }, 15000);

    return () => {
      clearInterval(pingInterval);
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
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
