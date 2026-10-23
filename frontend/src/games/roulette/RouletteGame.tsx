import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  Coins,
  History,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Users,
  Timer,
  ChevronDown,
  ChevronUp,
  X,
  Flame,
  RotateCw,
} from 'lucide-react';
import { RouletteWheel, RED_SET, WHEEL_NUMBERS } from './RouletteWheel';
import { rouletteAudio } from './RouletteAudio';
import { ApiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { UserRole } from '../../../../shared/src/types';

interface RouletteBet {
  id: string;
  type: string;
  numbers: number[];
  amount: number;
}

const CHIP_VALUES = [10, 50, 100, 500, 1000, 5000];

export const RouletteGame: React.FC<{ onBackToLobby: () => void }> = ({ onBackToLobby }) => {
  const { user, wallet, refreshUser } = useAuth();
  const { rouletteRound: websocketRound, rouletteHistory: websocketHistory } = useWebSocket();
  const [authoritativeRound, setAuthoritativeRound] = useState<any | null>(null);
  const [authoritativeHistory, setAuthoritativeHistory] = useState<any[]>([]);
  // Once the Supabase round has loaded, no in-memory WebSocket round/history is used.
  const rouletteRound = authoritativeRound ?? websocketRound;
  const rouletteHistory = authoritativeRound ? authoritativeHistory : websocketHistory;

  const [selectedChip, setSelectedChip] = useState<number>(50);
  // Staged bets in user's betting UI
  const [currentBets, setCurrentBets] = useState<RouletteBet[]>([]);
  const [betHistoryStack, setBetHistoryStack] = useState<RouletteBet[][]>([]);
  const [previousBets, setPreviousBets] = useState<RouletteBet[]>([]);
  // Confirmed/locked bets sent to server for the current round
  const [lockedBets, setLockedBets] = useState<RouletteBet[]>([]);
  const [isSubmittingBet, setIsSubmittingBet] = useState<boolean>(false);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showFairnessModal, setShowFairnessModal] = useState<boolean>(false);
  const [showCommunityDrawer, setShowCommunityDrawer] = useState<boolean>(false);
  const [poolBalance, setPoolBalance] = useState<string>('2000000');
  const [gameAvailability, setGameAvailability] = useState<'checking' | 'active' | 'unavailable'>('checking');

  // Live timer ticker for smooth seconds countdown
  const [timeLeftSec, setTimeLeftSec] = useState<number>(14);
  const [roundResultData, setRoundResultData] = useState<any | null>(null);
  const [myWinResult, setMyWinResult] = useState<{ totalPayout: number; netProfit: number } | null>(null);
  const [isTestSpinning, setIsTestSpinning] = useState<boolean>(false);
  const [testSpinNumber, setTestSpinNumber] = useState<number | null>(null);
  const [lastSettledNumber, setLastSettledNumber] = useState<number | null>(null);

  const lastProcessedRoundIdRef = useRef<string | null>(null);

  // Initialize lastSettledNumber from history on mount
  useEffect(() => {
    if (authoritativeRound && lastSettledNumber === null && rouletteHistory.length > 0) {
      setLastSettledNumber(rouletteHistory[0].number);
    }
  }, [authoritativeRound, rouletteHistory, lastSettledNumber]);

  const handleTestSpin = () => {
    setErrorMessage('Preview spins are disabled. The winning number comes only from the authoritative server round.');
    setTimeout(() => setErrorMessage(null), 3000);
  };

  const handleSpinComplete = (landedNum: number) => {
    setLastSettledNumber(landedNum);

    // History is populated only from backend-persisted round results.

    if (isTestSpinning) {
      setIsTestSpinning(false);
      setTestSpinNumber(null);

      // Evaluate bets if player had staged or locked bets on the table
      const betsToTest = currentBets.length > 0 ? currentBets : lockedBets;
      if (betsToTest.length > 0) {
        let totalWin = 0;
        let totalBet = 0;
        for (const b of betsToTest) {
          totalBet += b.amount;
          if (checkBetWinLocal(b, landedNum)) {
            totalWin += b.amount * getMultiplierLocal(b.type);
          }
        }
        if (totalWin > 0) {
          setMyWinResult({ totalPayout: totalWin, netProfit: totalWin - totalBet });
          rouletteAudio.playWinFanfare();
        } else {
          setMyWinResult({ totalPayout: 0, netProfit: -totalBet });
        }
      }
    }
  };

  // The production API is authoritative for availability. Never show the
  // legacy in-memory WebSocket preview as a playable game when Supabase has no
  // active persistent Roulette round.
  useEffect(() => {
    let mounted = true;
    const refreshAvailability = async () => {
      try {
        const data: any = await ApiClient.getRouletteState();
        if (!mounted) return;
        if (data?.poolBalance) setPoolBalance(String(data.poolBalance));
        const ready = data?.status === 'ACTIVE' && Boolean(data?.round) && data?.gameStateUnavailable !== true;
        if (ready) {
          setAuthoritativeRound(data.round);
          setAuthoritativeHistory(Array.isArray(data.history) ? data.history.map((item: any) => ({
            number: item.result?.number,
            color: item.result?.color,
            roundNumber: item.roundNumber,
            timestamp: item.timestamp,
          })) : []);
        } else {
          setAuthoritativeRound(null);
          setAuthoritativeHistory([]);
        }
        setGameAvailability(ready ? 'active' : 'unavailable');
      } catch {
        if (mounted) setGameAvailability('unavailable');
      }
    };

    void refreshAvailability();
    const interval = window.setInterval(() => void refreshAvailability(), 1000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  // Update timer countdown every 200ms based on round phase endsAt timestamp
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (rouletteRound.status === 'BETTING') {
        const diff = Math.max(0, Math.ceil((rouletteRound.bettingEndsAt - now) / 1000));
        setTimeLeftSec(diff);
      } else if (rouletteRound.status === 'SPINNING' && rouletteRound.spinEndsAt) {
        const diff = Math.max(0, Math.ceil((rouletteRound.spinEndsAt - now) / 1000));
        setTimeLeftSec(diff);
      } else {
        setTimeLeftSec(0);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [rouletteRound.status, rouletteRound.bettingEndsAt, rouletteRound.spinEndsAt]);

  // Handle round transitions & automatic reset for next round
  useEffect(() => {
    // When round changes to BETTING, clear locked bets and stage fresh round
    if (rouletteRound.id !== lastProcessedRoundIdRef.current) {
      lastProcessedRoundIdRef.current = rouletteRound.id;
      if (rouletteRound.status === 'BETTING') {
        setLockedBets([]);
        setCurrentBets([]);
        setBetHistoryStack([]);
        setRoundResultData(null);
        setMyWinResult(null);
        if (refreshUser) refreshUser();
      }
    }
  }, [rouletteRound.id, rouletteRound.status, refreshUser]);

  // Round outcomes and settlement are read from the Supabase state poll above.
  // WebSocket preview events are intentionally not allowed to settle or score bets.

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    rouletteAudio.enabled = next;
  };

  const stagedBetTotal = currentBets.reduce((acc, b) => acc + b.amount, 0);
  const lockedBetTotal = lockedBets.reduce((acc, b) => acc + b.amount, 0);
  const totalUserBet = stagedBetTotal + lockedBetTotal;

  // Local multiplier table
  const getMultiplierLocal = (type: string): number => {
    switch (type) {
      case 'straight': return 36;
      case 'split': return 18;
      case 'street': return 12;
      case 'corner': return 9;
      case 'line': return 6;
      case 'col1':
      case 'col2':
      case 'col3':
      case 'dozen1':
      case 'dozen2':
      case 'dozen3': return 3;
      case 'red':
      case 'black':
      case 'even':
      case 'odd':
      case 'low':
      case 'high': return 2;
      default: return 0;
    }
  };

  // Local bet win evaluator
  const checkBetWinLocal = (bet: { type: string; numbers: number[] }, num: number): boolean => {
    if (num === 0) {
      return bet.numbers.includes(0);
    }
    switch (bet.type) {
      case 'straight':
      case 'split':
      case 'street':
      case 'corner':
      case 'line':
        return bet.numbers.includes(num);
      case 'red':
        return RED_SET.has(num);
      case 'black':
        return !RED_SET.has(num);
      case 'even':
        return num % 2 === 0;
      case 'odd':
        return num % 2 !== 0;
      case 'low':
        return num >= 1 && num <= 18;
      case 'high':
        return num >= 19 && num <= 36;
      case 'dozen1':
        return num >= 1 && num <= 12;
      case 'dozen2':
        return num >= 13 && num <= 24;
      case 'dozen3':
        return num >= 25 && num <= 36;
      case 'col1':
        return num % 3 === 1;
      case 'col2':
        return num % 3 === 2;
      case 'col3':
        return num % 3 === 0;
      default:
        return false;
    }
  };

  // Place or adjust a bet in the staging pool
  const placeBet = (type: string, numbers: number[]) => {
    if (rouletteRound.status !== 'BETTING') {
      setErrorMessage('Bets are closed! Wheel is spinning. Next round starts shortly.');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    const currentBalance = wallet ? parseInt(wallet.balance, 10) : 0;
    if (totalUserBet + selectedChip > currentBalance) {
      setErrorMessage(`Insufficient token balance! (Available: ${currentBalance.toLocaleString()})`);
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    rouletteAudio.playChipSound();
    setBetHistoryStack((prev) => [...prev, [...currentBets]]);

    setCurrentBets((prev) => {
      const existingIdx = prev.findIndex(
        (b) => b.type === type && JSON.stringify(b.numbers) === JSON.stringify(numbers)
      );

      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          amount: updated[existingIdx].amount + selectedChip,
        };
        return updated;
      } else {
        const newBet: RouletteBet = {
          id: `bet-${type}-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          type,
          numbers,
          amount: selectedChip,
        };
        return [...prev, newBet];
      }
    });
  };

  // Clear staged bets
  const clearBets = () => {
    if (rouletteRound.status !== 'BETTING' || currentBets.length === 0) return;
    setBetHistoryStack((prev) => [...prev, [...currentBets]]);
    setCurrentBets([]);
  };

  // Undo last staged bet
  const undoLastBet = () => {
    if (rouletteRound.status !== 'BETTING' || betHistoryStack.length === 0) return;
    const last = betHistoryStack[betHistoryStack.length - 1];
    setBetHistoryStack((prev) => prev.slice(0, -1));
    setCurrentBets(last);
  };

  // Double current staged bets (2x)
  const doubleBets = () => {
    if (rouletteRound.status !== 'BETTING' || currentBets.length === 0) return;
    const currentBalance = wallet ? parseInt(wallet.balance, 10) : 0;
    if (totalUserBet + stagedBetTotal > currentBalance) {
      setErrorMessage('Insufficient balance to double bets');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }
    setBetHistoryStack((prev) => [...prev, [...currentBets]]);
    setCurrentBets((prev) =>
      prev.map((b) => ({
        ...b,
        amount: b.amount * 2,
      }))
    );
  };

  // Rebet previous spin's bets
  const rebetPrevious = () => {
    if (rouletteRound.status !== 'BETTING' || previousBets.length === 0) return;
    const prevTotal = previousBets.reduce((a, b) => a + b.amount, 0);
    const currentBalance = wallet ? parseInt(wallet.balance, 10) : 0;
    if (totalUserBet + prevTotal > currentBalance) {
      setErrorMessage('Insufficient balance to rebet previous stake');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }
    setBetHistoryStack((prev) => [...prev, [...currentBets]]);
    setCurrentBets([...previousBets]);
  };

  // Authoritatively lock in staged bets to the server round
  const handleLockInBets = async () => {
    if (rouletteRound.status !== 'BETTING') {
      setErrorMessage('Betting closed for this round!');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }
    if (currentBets.length === 0) {
      setErrorMessage('Place chips on the table first!');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }
    if (user?.role !== UserRole.PLAYER) {
      setErrorMessage('Only Player accounts can place bets');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    setIsSubmittingBet(true);
    setErrorMessage(null);

    try {
      const payload = {
        bets: currentBets.map((b) => ({
          id: b.id,
          type: b.type,
          numbers: b.numbers,
          amount: b.amount.toString(),
        })),
      };

      const res: any = await ApiClient.placeRouletteBet(payload);
      if (res && res.success) {
        rouletteAudio.playChipSound();
        setPreviousBets([...lockedBets, ...currentBets]);
        setLockedBets((prev) => [...prev, ...currentBets]);
        setCurrentBets([]);
        setBetHistoryStack([]);
        setSuccessMessage(`Locked ${res.betCount} bet(s) totaling ₹${res.totalBet} for Round #${rouletteRound.roundNumber}!`);
        setTimeout(() => setSuccessMessage(null), 3500);
        if (refreshUser) refreshUser();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error locking in bets');
      setTimeout(() => setErrorMessage(null), 4000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  // Get total bet placed on a specific type & number combo (staged + locked)
  const getCellBetAmount = (type: string, numbers?: number[]) => {
    let sum = 0;
    const all = [...lockedBets, ...currentBets];
    for (const b of all) {
      if (b.type === type) {
        if (!numbers || numbers.length === 0) {
          sum += b.amount;
        } else if (JSON.stringify(b.numbers) === JSON.stringify(numbers)) {
          sum += b.amount;
        }
      }
    }
    return sum;
  };

  const getNumberBetAmount = (num: number) => {
    let sum = 0;
    const all = [...lockedBets, ...currentBets];
    for (const b of all) {
      if (b.type === 'straight' && b.numbers.includes(num)) {
        sum += b.amount;
      }
    }
    return sum;
  };

  // Highlight winning cells during result phase or settled state
  const isWinningNumber = (num: number) => {
    if (rouletteRound.status === 'RESULT') {
      return (rouletteRound.winningNumber ?? lastSettledNumber) === num;
    }
    return lastSettledNumber === num;
  };

  const activeDisplayNum =
    rouletteRound.status === 'SPINNING'
      ? (rouletteRound.winningNumber ?? testSpinNumber)
      : (rouletteRound.winningNumber ?? lastSettledNumber ?? (rouletteHistory[0]?.number ?? 0));

  const isWinningType = (type: string) => {
    if (activeDisplayNum === null || activeDisplayNum === undefined) return false;
    return checkBetWinLocal({ type, numbers: [] }, activeDisplayNum);
  };

  const winningColor =
    activeDisplayNum !== null && activeDisplayNum !== undefined
      ? activeDisplayNum === 0
        ? 'green'
        : RED_SET.has(activeDisplayNum)
        ? 'red'
        : 'black'
      : null;

  if (gameAvailability !== 'active') {
    return (
      <div className="min-h-[60vh] w-full flex items-center justify-center px-4 py-8 text-zinc-100">
        <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
            <ShieldCheck size={26} />
          </div>
          <h2 className="text-xl font-bold text-white">Roulette is not available yet</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {gameAvailability === 'checking'
              ? 'Checking the authoritative Supabase game state…'
              : 'Roulette is temporarily disabled until persistent rounds and settlement are ready. No bets can be placed from this screen.'}
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="mt-5 rounded-lg border border-zinc-600 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            Back to games
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-2 py-1.5 space-y-1.5 text-zinc-100 pb-12 select-none">
      {/* 1. TOP STATUS BAR: Multi-Player Indicator, Recent History */}
      <div className="flex items-center justify-between gap-1.5 bg-zinc-900/90 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[10px] font-mono font-bold text-amber-300">
              #{rouletteRound.roundNumber}
            </span>
          </div>
        </div>

        {/* Scrollable Recent Roulette Numbers Bar (Exact match with settled ball pocket) */}
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 px-1 justify-center">
          <span className="text-[9px] font-mono font-bold text-amber-400/90 uppercase tracking-wider shrink-0 hidden sm:inline">
            History:
          </span>
          {rouletteHistory.slice(0, 9).map((h, i) => {
            const isLatest = i === 0;
            return (
              <div key={i} className="relative shrink-0 flex items-center justify-center">
                <span
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-mono font-bold border shrink-0 leading-none shadow-sm transition-all ${
                    isLatest
                      ? 'ring-2 ring-yellow-400 scale-105 shadow-md shadow-yellow-500/40 z-10 font-black'
                      : 'opacity-90'
                  } ${
                    h.number === 0
                      ? 'bg-emerald-600 text-white border-emerald-400 shadow-emerald-500/20'
                      : h.color === 'red'
                      ? 'bg-red-600 text-white border-red-500 shadow-red-500/20'
                      : 'bg-zinc-800 text-zinc-200 border-zinc-600'
                  }`}
                  title={isLatest ? `Ball Landed on #${h.number} (${h.color.toUpperCase()}) - Latest Result` : `Pocket #${h.number}`}
                >
                  {h.number}
                </span>
                {isLatest && (
                  <span className="absolute -top-1 -right-0.5 w-2 h-2 rounded-full bg-yellow-400 animate-ping pointer-events-none" />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleSound}
            className="p-1.5 text-zinc-400 hover:text-amber-300 transition rounded-lg hover:bg-zinc-800"
            title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
          </button>
          <button
            onClick={() => setShowFairnessModal(true)}
            className="p-1.5 text-zinc-400 hover:text-emerald-300 transition rounded-lg hover:bg-zinc-800"
            title="Provably Fair RNG"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </div>

      {/* 2. COMPACT COUNTDOWN (CHINADHI COUNTDOWN) */}
      <div className="flex items-center justify-between bg-zinc-900/90 border border-zinc-800/80 rounded-xl px-2.5 py-1.5 shadow-sm">
        <div className="flex items-center gap-2">
          {rouletteRound.status === 'BETTING' && (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-[11px] font-bold uppercase tracking-wider">Place Your Bets</span>
            </div>
          )}
          {rouletteRound.status === 'SPINNING' && (
            <div className="flex items-center gap-1.5 text-amber-300">
              <Flame className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Wheel Spinning</span>
            </div>
          )}
          {rouletteRound.status === 'RESULT' && (
            <div className="flex items-center gap-1.5 text-yellow-300">
              <Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Winning: #{rouletteRound.winningNumber ?? activeDisplayNum} ({winningColor?.toUpperCase()})
              </span>
            </div>
          )}
        </div>

        {/* Small Countdown Timer Badge */}
        <div className="flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-zinc-400" />
          {rouletteRound.status === 'BETTING' && (
            <span className="font-mono text-xs font-black text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-600/40">
              {timeLeftSec}s
            </span>
          )}
          {rouletteRound.status === 'SPINNING' && (
            <span className="font-mono text-xs font-black text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-600/40">
              {timeLeftSec}s
            </span>
          )}
          {rouletteRound.status === 'RESULT' && (
            <span className="font-mono text-[10px] font-bold text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/50">
              Next round...
            </span>
          )}
        </div>
      </div>

      {/* 3. CELEBRATION WIN BANNER FOR RESULT PHASE */}
      {rouletteRound.status === 'RESULT' && myWinResult && myWinResult.totalPayout > 0 && (
        <div className="p-2.5 rounded-xl bg-gradient-to-r from-amber-600/30 via-yellow-500/25 to-emerald-600/30 border border-yellow-500/50 text-center animate-bounce shadow-lg">
          <div className="flex items-center justify-center gap-1.5 text-yellow-300 font-black text-sm">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span>YOU WON ₹{myWinResult.totalPayout.toLocaleString()}!</span>
          </div>
          <div className="text-[10px] text-emerald-400 font-mono font-bold mt-0.5">
            +₹{myWinResult.netProfit.toLocaleString()} Net Profit credited to your wallet!
          </div>
        </div>
      )}

      {/* Alerts */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-950/80 border border-red-800/60 text-red-200 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-950/80 border border-emerald-800/60 text-emerald-200 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 4. 3D ROULETTE WHEEL COMPONENT */}
      <div className="w-full flex flex-col items-center justify-center py-1">
        <RouletteWheel
          isSpinning={rouletteRound.status === 'SPINNING' || isTestSpinning}
          targetNumber={
            isTestSpinning
              ? (testSpinNumber ?? 0)
              : rouletteRound.status === 'SPINNING'
              ? (rouletteRound.winningNumber ?? 0)
              : (lastSettledNumber ?? rouletteRound.winningNumber ?? (rouletteHistory[0]?.number ?? 0))
          }
          spinEndsAt={rouletteRound.status === 'SPINNING' ? rouletteRound.spinEndsAt : null}
          spinDuration={isTestSpinning ? 8000 : 9500}
          size={255}
          onSpinComplete={handleSpinComplete}
          onManualSpinRequest={handleTestSpin}
        />

        {/* Quick Spin Action & Synced Pocket Status */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {rouletteRound.status === 'SPINNING' || isTestSpinning ? (
            <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-mono font-bold animate-pulse">
              <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span>WHEEL SPINNING • FAST</span>
            </div>
          ) : (
            <button
              onClick={handleTestSpin}
              className="flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/30 border border-amber-400/50 text-amber-300 text-[11px] font-semibold transition active:scale-95 shadow-sm hover:shadow-amber-500/20"
              title="Spin wheel preview animation"
            >
              <RotateCw className="w-3.5 h-3.5 text-amber-400" />
              <span>Spin Wheel</span>
            </button>
          )}

          {/* Landed pocket indicator showing exact same number as History */}
          {lastSettledNumber !== null && rouletteRound.status !== 'SPINNING' && !isTestSpinning && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900/90 border border-amber-500/30 text-[11px] shadow-sm">
              <span className="text-zinc-400 text-[10px]">Ball Pocket:</span>
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center font-mono font-black text-[9px] text-white shadow-sm ${
                  lastSettledNumber === 0
                    ? 'bg-emerald-600'
                    : RED_SET.has(lastSettledNumber)
                    ? 'bg-red-600'
                    : 'bg-zinc-800 border border-zinc-600'
                }`}
              >
                {lastSettledNumber}
              </span>
              <span className="font-mono font-bold text-yellow-400 text-[11px]">
                {lastSettledNumber === 0
                  ? '0 GREEN'
                  : `${lastSettledNumber} (${RED_SET.has(lastSettledNumber) ? 'RED' : 'BLACK'})`}
              </span>
              <span className="text-emerald-400 font-semibold text-[10px] flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" />
                <span>In History</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 5. BETTING BOARD / TABLE GRID */}
      <div className="w-full bg-emerald-950/40 border border-emerald-900/60 rounded-xl p-2 shadow-inner">
          {/* A. ZERO POCKET */}
          <div className="mb-1">
            <button
              onClick={() => placeBet('straight', [0])}
              className={`w-full py-2 rounded-lg font-mono font-black text-sm border transition relative active:scale-95 flex items-center justify-center gap-1.5 ${
                isWinningNumber(0)
                  ? 'bg-emerald-400 text-black border-yellow-400 ring-2 ring-yellow-400 shadow-lg'
                  : 'bg-emerald-700/80 hover:bg-emerald-600 text-white border-emerald-500/80 shadow-sm'
              }`}
            >
              <span>0 (GREEN)</span>
              {getNumberBetAmount(0) > 0 && (
                <span className="bg-amber-400 text-black font-mono font-bold text-[10px] px-1.5 py-0.2 rounded-full shadow">
                  ₹{getNumberBetAmount(0)}
                </span>
              )}
            </button>
          </div>

          {/* B. MAIN 3x12 NUMBERS GRID */}
          <div className="grid grid-cols-12 gap-1 mb-1.5">
            {/* Row 3 (3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36) */}
            {[3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36].map((num) => {
              const isRed = RED_SET.has(num);
              const betAmt = getNumberBetAmount(num);
              const isWinner = isWinningNumber(num);
              return (
                <button
                  key={num}
                  onClick={() => placeBet('straight', [num])}
                  className={`h-9 rounded font-mono font-bold text-[11px] border flex flex-col items-center justify-center relative active:scale-90 transition ${
                    isWinner
                      ? 'bg-yellow-400 text-black border-yellow-300 ring-2 ring-yellow-300 shadow-lg font-black'
                      : isRed
                      ? 'bg-red-700/90 hover:bg-red-600 text-white border-red-500/70'
                      : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700/70'
                  }`}
                >
                  <span>{num}</span>
                  {betAmt > 0 && (
                    <span className="absolute -top-1 -right-1 bg-amber-400 text-black text-[8px] font-mono font-black px-1 rounded-full shadow border border-amber-600">
                      {betAmt >= 1000 ? `${(betAmt / 1000).toFixed(0)}k` : betAmt}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Row 2 (2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35) */}
            {[2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35].map((num) => {
              const isRed = RED_SET.has(num);
              const betAmt = getNumberBetAmount(num);
              const isWinner = isWinningNumber(num);
              return (
                <button
                  key={num}
                  onClick={() => placeBet('straight', [num])}
                  className={`h-9 rounded font-mono font-bold text-[11px] border flex flex-col items-center justify-center relative active:scale-90 transition ${
                    isWinner
                      ? 'bg-yellow-400 text-black border-yellow-300 ring-2 ring-yellow-300 shadow-lg font-black'
                      : isRed
                      ? 'bg-red-700/90 hover:bg-red-600 text-white border-red-500/70'
                      : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700/70'
                  }`}
                >
                  <span>{num}</span>
                  {betAmt > 0 && (
                    <span className="absolute -top-1 -right-1 bg-amber-400 text-black text-[8px] font-mono font-black px-1 rounded-full shadow border border-amber-600">
                      {betAmt >= 1000 ? `${(betAmt / 1000).toFixed(0)}k` : betAmt}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Row 1 (1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34) */}
            {[1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34].map((num) => {
              const isRed = RED_SET.has(num);
              const betAmt = getNumberBetAmount(num);
              const isWinner = isWinningNumber(num);
              return (
                <button
                  key={num}
                  onClick={() => placeBet('straight', [num])}
                  className={`h-9 rounded font-mono font-bold text-[11px] border flex flex-col items-center justify-center relative active:scale-90 transition ${
                    isWinner
                      ? 'bg-yellow-400 text-black border-yellow-300 ring-2 ring-yellow-300 shadow-lg font-black'
                      : isRed
                      ? 'bg-red-700/90 hover:bg-red-600 text-white border-red-500/70'
                      : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700/70'
                  }`}
                >
                  <span>{num}</span>
                  {betAmt > 0 && (
                    <span className="absolute -top-1 -right-1 bg-amber-400 text-black text-[8px] font-mono font-black px-1 rounded-full shadow border border-amber-600">
                      {betAmt >= 1000 ? `${(betAmt / 1000).toFixed(0)}k` : betAmt}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* C. 2 TO 1 COLUMN BETS */}
          <div className="grid grid-cols-3 gap-1 mb-1.5">
            {[
              { type: 'col1', label: '1st Col (2:1)' },
              { type: 'col2', label: '2nd Col (2:1)' },
              { type: 'col3', label: '3rd Col (2:1)' },
            ].map((col) => {
              const betAmt = getCellBetAmount(col.type);
              const isWin = isWinningType(col.type);
              return (
                <button
                  key={col.type}
                  onClick={() => placeBet(col.type, [])}
                  className={`py-1.5 rounded font-semibold text-[10px] border flex items-center justify-center gap-1 transition relative active:scale-95 ${
                    isWin
                      ? 'bg-yellow-400 text-black border-yellow-300 font-bold'
                      : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border-zinc-700/60'
                  }`}
                >
                  <span>{col.label}</span>
                  {betAmt > 0 && (
                    <span className="bg-amber-400 text-black text-[9px] font-mono font-bold px-1 rounded-full">
                      ₹{betAmt}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* D. DOZENS (1st 12, 2nd 12, 3rd 12) */}
          <div className="grid grid-cols-3 gap-1 mb-1.5">
            {[
              { type: 'dozen1', label: '1st 12 (1-12)' },
              { type: 'dozen2', label: '2nd 12 (13-24)' },
              { type: 'dozen3', label: '3rd 12 (25-36)' },
            ].map((doz) => {
              const betAmt = getCellBetAmount(doz.type);
              const isWin = isWinningType(doz.type);
              return (
                <button
                  key={doz.type}
                  onClick={() => placeBet(doz.type, [])}
                  className={`py-1.5 rounded font-semibold text-[10px] border flex items-center justify-center gap-1 transition relative active:scale-95 ${
                    isWin
                      ? 'bg-yellow-400 text-black border-yellow-300 font-bold'
                      : 'bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-200 border-emerald-700/50'
                  }`}
                >
                  <span>{doz.label}</span>
                  {betAmt > 0 && (
                    <span className="bg-amber-400 text-black text-[9px] font-mono font-bold px-1 rounded-full">
                      ₹{betAmt}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* E. OUTSIDE EVEN-MONEY BETS (1-18, EVEN, RED, BLACK, ODD, 19-36) */}
          <div className="grid grid-cols-6 gap-1">
            {[
              { type: 'low', label: '1 - 18' },
              { type: 'even', label: 'EVEN' },
              { type: 'red', label: 'RED', isRed: true },
              { type: 'black', label: 'BLACK', isBlack: true },
              { type: 'odd', label: 'ODD' },
              { type: 'high', label: '19 - 36' },
            ].map((out) => {
              const betAmt = getCellBetAmount(out.type);
              const isWin = isWinningType(out.type);
              return (
                <button
                  key={out.type}
                  onClick={() => placeBet(out.type, [])}
                  className={`py-2 rounded font-bold text-[10px] border flex flex-col items-center justify-center gap-0.5 transition relative active:scale-95 ${
                    isWin
                      ? 'bg-yellow-400 text-black border-yellow-300 font-black'
                      : out.isRed
                      ? 'bg-red-700 hover:bg-red-600 text-white border-red-500'
                      : out.isBlack
                      ? 'bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border-zinc-700'
                      : 'bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border-zinc-700/60'
                  }`}
                >
                  <span>{out.label}</span>
                  {betAmt > 0 && (
                    <span className="bg-amber-400 text-black text-[8px] font-mono font-bold px-1 rounded-full shadow">
                      ₹{betAmt}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

      {/* 6. CHIP VALUE SELECTOR BAR */}
      <div className="flex items-center justify-between gap-1 bg-zinc-900/80 p-1.5 rounded-xl border border-zinc-800">
        <div className="flex items-center gap-1 text-[10px] text-zinc-400 font-medium px-1">
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span>Chip:</span>
        </div>
        <div className="flex-1 flex items-center justify-around gap-1 overflow-x-auto scrollbar-none py-0.5">
          {CHIP_VALUES.map((val) => {
            const isSelected = selectedChip === val;
            return (
              <button
                key={val}
                onClick={() => {
                  setSelectedChip(val);
                  rouletteAudio.playChipSound();
                }}
                className={`w-9 h-9 rounded-full font-mono font-black text-[10px] flex items-center justify-center transition shrink-0 active:scale-95 border-2 shadow-md ${
                  isSelected
                    ? 'ring-2 ring-amber-400 scale-105 border-yellow-300'
                    : 'opacity-80 hover:opacity-100 border-zinc-700'
                } ${
                  val === 10
                    ? 'bg-blue-600 text-white'
                    : val === 50
                    ? 'bg-red-600 text-white'
                    : val === 100
                    ? 'bg-emerald-600 text-white'
                    : val === 500
                    ? 'bg-purple-600 text-white'
                    : val === 1000
                    ? 'bg-amber-600 text-white'
                    : 'bg-zinc-800 text-amber-300'
                }`}
              >
                {val >= 1000 ? `${val / 1000}k` : val}
              </button>
            );
          })}
        </div>
      </div>

      {/* 8. ACTION CONTROLS & LOCK IN BET BUTTON */}
      <div className="space-y-1.5">
        {/* Quick Utilities (Undo, Clear, Double, Rebet) */}
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={undoLastBet}
            disabled={rouletteRound.status !== 'BETTING' || betHistoryStack.length === 0}
            className="py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-zinc-300 text-[10px] font-semibold border border-zinc-800 transition active:scale-95"
          >
            Undo
          </button>
          <button
            onClick={clearBets}
            disabled={rouletteRound.status !== 'BETTING' || currentBets.length === 0}
            className="py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-zinc-300 text-[10px] font-semibold border border-zinc-800 transition active:scale-95"
          >
            Clear
          </button>
          <button
            onClick={doubleBets}
            disabled={rouletteRound.status !== 'BETTING' || currentBets.length === 0}
            className="py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-zinc-300 text-[10px] font-semibold border border-zinc-800 transition active:scale-95"
          >
            2x Double
          </button>
          <button
            onClick={rebetPrevious}
            disabled={rouletteRound.status !== 'BETTING' || previousBets.length === 0}
            className="py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-zinc-300 text-[10px] font-semibold border border-zinc-800 transition active:scale-95"
          >
            Rebet
          </button>
        </div>

        {/* Lock In / Place Bet Button */}
        {rouletteRound.status === 'BETTING' ? (
          <button
            onClick={handleLockInBets}
            disabled={isSubmittingBet || currentBets.length === 0}
            className="w-full py-3 rounded-xl font-black text-sm bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-500 text-black shadow-lg shadow-emerald-500/20 active:scale-98 transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmittingBet ? (
              <span className="animate-pulse">Locking In Bets...</span>
            ) : currentBets.length > 0 ? (
              <>
                <Coins className="w-4 h-4 text-black" />
                <span>CONFIRM & LOCK IN BET (₹{stagedBetTotal.toLocaleString()})</span>
              </>
            ) : lockedBets.length > 0 ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-black" />
                <span>BETS LOCKED (₹{lockedBetTotal.toLocaleString()}) • PLACE MORE OR WAIT</span>
              </>
            ) : (
              <span>SELECT CHIPS & TAP BOARD TO BET</span>
            )}
          </button>
        ) : rouletteRound.status === 'SPINNING' ? (
          <div className="w-full py-3 rounded-xl font-black text-sm bg-zinc-900 border border-amber-500/40 text-amber-300 shadow-md text-center flex items-center justify-center gap-2">
            <Flame className="w-4 h-4 text-amber-400 animate-spin" />
            <span>WHEEL IS SPINNING • NO MORE BETS ({timeLeftSec}s)</span>
          </div>
        ) : (
          <div className="w-full py-3 rounded-xl font-black text-sm bg-zinc-900 border border-yellow-500/40 text-yellow-300 shadow-md text-center flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-yellow-400 animate-pulse" />
            <span>ROUND SETTLED • NEXT ROUND IN A FEW SECONDS...</span>
          </div>
        )}

        {/* Active Bet Summary Bar */}
        <div className="flex items-center justify-between px-2 py-1 bg-zinc-950/60 rounded-lg border border-zinc-800/80 text-[10px] text-zinc-400">
          <span>Staged: <strong className="text-zinc-200 font-mono">₹{stagedBetTotal}</strong></span>
          <span>Locked in Round: <strong className="text-emerald-400 font-mono">₹{lockedBetTotal}</strong></span>
          <span>Wallet: <strong className="text-amber-400 font-mono">₹{wallet ? parseInt(wallet.balance, 10).toLocaleString() : 0}</strong></span>
        </div>
      </div>

      {/* 9. PROVABLY FAIR VERIFICATION MODAL */}
      {showFairnessModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <ShieldCheck className="w-4 h-4" />
                <span>Provably Fair European Roulette</span>
              </div>
              <button
                onClick={() => setShowFairnessModal(false)}
                className="text-zinc-500 hover:text-zinc-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-zinc-300 leading-relaxed">
              <p>
                Every European Roulette round is generated server-authoritatively using Node.js Cryptographically Secure Pseudo-Random Number Generation (CSPRNG):
              </p>
              <div className="p-2.5 rounded-lg bg-zinc-950 font-mono text-[11px] text-zinc-400 space-y-1 border border-zinc-800">
                <div>Current Round: #{rouletteRound.roundNumber}</div>
                <div>Outcome: server-seeded result persisted in Supabase</div>
                <div>Pocket Range: 0 to 36 (European 37-pocket)</div>
                <div>House Edge: 2.70% (Single Zero)</div>
              </div>
              <p className="text-[11px] text-zinc-400">
                All players receive the same persisted round phase and winning pocket from the backend; wallet settlement is server-owned.
              </p>
            </div>
            <button
              onClick={() => setShowFairnessModal(false)}
              className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
