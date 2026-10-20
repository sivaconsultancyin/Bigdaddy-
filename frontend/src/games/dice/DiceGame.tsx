import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Sparkles,
  HelpCircle,
  Trophy,
  Coins,
  ShieldCheck,
  RotateCcw,
  TrendingUp,
  X,
  AlertCircle,
  Users,
  Lock,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { ApiClient } from '../../api/client';
import { diceAudio } from './DiceAudio';
import { CssDiceArena } from './CssDiceArena';

const CHIP_DENOMINATIONS = [10, 50, 100, 500, 1000, 5000];
const NUMBERS_1_TO_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const DiceGame: React.FC<{ onBackToLobby: () => void }> = ({ onBackToLobby }) => {
  const { user, wallet, refreshWallet } = useAuth();
  const {
    isConnected,
    diceRound: wsDiceRound,
    diceHistory: wsDiceHistory,
    diceLiveBets: wsDiceLiveBets,
  } = useWebSocket();

  // Local authoritative state with WebSocket + HTTP Polling fallback
  const [roundState, setRoundState] = useState(wsDiceRound);
  const [history, setHistory] = useState(wsDiceHistory);
  const [liveBets, setLiveBets] = useState(wsDiceLiveBets);

  // Audio & Modals
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [activeRulesTab, setActiveRulesTab] = useState<'rules' | 'payouts' | 'provablyFair' | 'faq'>('rules');
  const [showFairnessModal, setShowFairnessModal] = useState<boolean>(false);
  const [showCommunityDrawer, setShowCommunityDrawer] = useState<boolean>(false);

  // Selected Chip Denomination
  const [selectedChip, setSelectedChip] = useState<number>(50);

  // 1 to 10 Bets in Current Round
  const [myBets, setMyBets] = useState<Record<string, number>>({});
  const [lastRoundBets, setLastRoundBets] = useState<Record<string, number>>({});
  const [isSubmittingBet, setIsSubmittingBet] = useState<boolean>(false);

  // Rapid rolling animation cycle state
  const [cycleDisplayNumber, setCycleDisplayNumber] = useState<number | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Synchronized Countdown Timer (calculated from server bettingEndsAt)
  const [timeLeftSec, setTimeLeftSec] = useState<number>(14);
  const lastRoundIdRef = useRef<string | null>(null);
  const lastResultFiredRef = useRef<string | null>(null);

  // Verify Modal State
  const [verifyServerSeed, setVerifyServerSeed] = useState<string>('');
  const [verifyClientSeed, setVerifyClientSeed] = useState<string>('client-seed-live');
  const [verifyNonce, setVerifyNonce] = useState<number>(1);
  const [verifyResult, setVerifyResult] = useState<number | null>(null);

  // Keep WebSocket sync in local state
  useEffect(() => {
    if (wsDiceRound) setRoundState(wsDiceRound);
  }, [wsDiceRound]);

  useEffect(() => {
    if (wsDiceHistory && wsDiceHistory.length > 0) setHistory(wsDiceHistory);
  }, [wsDiceHistory]);

  useEffect(() => {
    if (wsDiceLiveBets) setLiveBets(wsDiceLiveBets);
  }, [wsDiceLiveBets]);

  // Robust HTTP polling fallback (every 1.5s) to guarantee single continuous multiplayer room
  const pollServerState = useCallback(async () => {
    try {
      const res = await ApiClient.getDiceState();
      if (res && res.round) {
        setRoundState(res.round);
      }
      if (res && res.history) {
        setHistory(res.history);
      }
      if (res && res.allBets) {
        setLiveBets(res.allBets);
      }
    } catch {
      // Ignore polling transient errors
    }
  }, []);

  useEffect(() => {
    pollServerState();
    const pollInterval = setInterval(pollServerState, 1500);
    return () => clearInterval(pollInterval);
  }, [pollServerState]);

  // Sound toggle sync
  useEffect(() => {
    diceAudio.enabled = soundEnabled;
  }, [soundEnabled]);

  // Synchronized Countdown Timer
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (roundState.status === 'BETTING') {
        const diff = Math.max(0, Math.ceil((roundState.bettingEndsAt - now) / 1000));
        setTimeLeftSec(diff);
        if (diff <= 3 && diff > 0) {
          diceAudio.playTickSound();
        }
      } else {
        setTimeLeftSec(0);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [roundState.status, roundState.bettingEndsAt]);

  // Handle Synchronized Round State Changes (BETTING -> ROLLING -> RESULT)
  useEffect(() => {
    // Detect fresh new round
    if (roundState.id !== lastRoundIdRef.current) {
      lastRoundIdRef.current = roundState.id;
      if (roundState.status === 'BETTING') {
        if (Object.keys(myBets).length > 0) {
          setLastRoundBets(myBets);
        }
        setMyBets({});
        setCycleDisplayNumber(null);
        lastResultFiredRef.current = null;
      }
    }

    // When betting starts: STRICTLY CLEAR ANY PREVIOUS OR FUTURE NUMBERS
    if (roundState.status === 'BETTING') {
      setCycleDisplayNumber(null);
      lastResultFiredRef.current = null;
    }

    // Rolling animation state: Rapid cycling simulation
    if (roundState.status === 'ROLLING') {
      diceAudio.playShakeSound();
      const cycleInterval = setInterval(() => {
        setCycleDisplayNumber((previous) => ((previous ?? 0) % 10) + 1);
      }, 60);

      const timeout = setTimeout(() => {
        clearInterval(cycleInterval);
      }, 4200);

      return () => {
        clearInterval(cycleInterval);
        clearTimeout(timeout);
      };
    }

    // Result announcement: ONLY reveal winning number in RESULT phase
    if (roundState.status === 'RESULT' && roundState.rolledNumber && lastResultFiredRef.current !== roundState.id) {
      lastResultFiredRef.current = roundState.id;
      const winNum = roundState.rolledNumber;
      setCycleDisplayNumber(winNum);
      diceAudio.playRollSound();

      // Check if user placed a winning bet
      const myExactBet = myBets[winNum.toString()] || 0;
      const mySmallBet = winNum <= 5 ? myBets['small'] || 0 : 0;
      const myBigBet = winNum >= 6 ? myBets['big'] || 0 : 0;
      const myEvenBet = winNum % 2 === 0 ? myBets['even'] || 0 : 0;
      const myOddBet = winNum % 2 !== 0 ? myBets['odd'] || 0 : 0;

      const userWon = myExactBet > 0 || mySmallBet > 0 || myBigBet > 0 || myEvenBet > 0 || myOddBet > 0;

      if (userWon) {
        diceAudio.playWinFanfare();
        confetti({
          particleCount: 120,
          spread: 85,
          origin: { y: 0.6 },
          colors: ['#10b981', '#f59e0b', '#3b82f6', '#ffd700'],
        });
        showNotification(`🎉 అభినందనలు! నంబర్ #${winNum} వచ్చింది! మీరు గెలిచారు!`);
        refreshWallet();
      } else {
        diceAudio.playLossSound();
      }
    }
  }, [roundState.id, roundState.status, roundState.rolledNumber]);

  const showNotification = (msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => setNoticeMessage(null), 3000);
  };

  // Place bet on a specific number (1..10) or group in the synchronized round
  const handlePlaceBet = async (type: string) => {
    if (roundState.status !== 'BETTING') {
      setErrorMessage('రౌండ్ బెట్టింగ్ ముగిసింది. తదుపరి రౌండ్ కోసం వేచి ఉండండి (Betting closed).');
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }

    const currentBalance = parseInt(wallet?.balance || '0', 10);
    if (currentBalance < selectedChip) {
      setErrorMessage('వాలెట్‌లో సరిపడా బ్యాలెన్స్ లేదు (Insufficient wallet balance)!');
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }

    diceAudio.playChipSound();
    setIsSubmittingBet(true);
    setErrorMessage(null);

    try {
      await ApiClient.placeDiceBet({
        bets: [{ type, amount: selectedChip.toString() }],
      });

      setMyBets((prev) => ({
        ...prev,
        [type]: (prev[type] || 0) + selectedChip,
      }));

      showNotification(`₹${selectedChip} placed on #${type.toUpperCase()}!`);
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error placing bet');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  // Select all 1 to 10 numbers equally
  const handleSelectAll = async () => {
    if (roundState.status !== 'BETTING') return;
    const totalCost = selectedChip * 10;
    const currentBalance = parseInt(wallet?.balance || '0', 10);
    if (currentBalance < totalCost) {
      setErrorMessage(`All 1-10 బెట్ కోసం ₹${totalCost} బ్యాలెన్స్ అవసరం!`);
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }

    setIsSubmittingBet(true);
    const betsPayload = NUMBERS_1_TO_10.map((num) => ({
      type: num.toString(),
      amount: selectedChip.toString(),
    }));

    try {
      await ApiClient.placeDiceBet({ bets: betsPayload });
      setMyBets((prev) => {
        const next = { ...prev };
        NUMBERS_1_TO_10.forEach((num) => {
          next[num.toString()] = (next[num.toString()] || 0) + selectedChip;
        });
        return next;
      });
      diceAudio.playChipSound();
      showNotification(`1 నుండి 10 వరకు అన్ని నంబర్లపై ₹${selectedChip} బెట్ వేయబడింది!`);
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not place all bets');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  // Double active bets in this round
  const handleDoubleBets = async () => {
    if (roundState.status !== 'BETTING') return;
    const keys = Object.keys(myBets).filter((k) => myBets[k] > 0);
    if (keys.length === 0) return;

    const betsPayload = keys.map((k) => ({
      type: k,
      amount: myBets[k].toString(),
    }));

    setIsSubmittingBet(true);
    try {
      await ApiClient.placeDiceBet({ bets: betsPayload });
      setMyBets((prev) => {
        const next = { ...prev };
        keys.forEach((k) => {
          next[k] = next[k] * 2;
        });
        return next;
      });
      diceAudio.playChipSound();
      showNotification('బెట్స్ రెట్టింపు (2x Doubled) చేయబడ్డాయి!');
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not double bets');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  // Rebet previous round bets
  const handleRebet = async () => {
    if (roundState.status !== 'BETTING') return;
    const keys = Object.keys(lastRoundBets).filter((k) => lastRoundBets[k] > 0);
    if (keys.length === 0) {
      setErrorMessage('మునుపటి రౌండ్ బెట్స్ ఏవీ లేవు.');
      setTimeout(() => setErrorMessage(null), 2000);
      return;
    }

    const betsPayload = keys.map((k) => ({
      type: k,
      amount: lastRoundBets[k].toString(),
    }));

    setIsSubmittingBet(true);
    try {
      await ApiClient.placeDiceBet({ bets: betsPayload });
      setMyBets(lastRoundBets);
      diceAudio.playChipSound();
      showNotification('మునుపటి రౌండ్ బెట్స్ రిపీట్ చేయబడ్డాయి!');
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not repeat bets');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  const totalMyBetAmount = Object.values(myBets).reduce((acc, v) => acc + v, 0);

  // Handle Verify Roll
  const handleVerify = async () => {
    try {
      const res = await ApiClient.verifyDiceRoll({
        serverSeed: verifyServerSeed,
        clientSeed: verifyClientSeed,
        nonce: verifyNonce,
      });
      setVerifyResult(res.calculatedRoll);
    } catch (e: any) {
      setErrorMessage(e.message || 'Verification error');
    }
  };

  const isRolling = roundState.status === 'ROLLING';
  const isResult = roundState.status === 'RESULT';
  // STRICT SECURITY: Winning number is ONLY defined in RESULT phase! During BETTING and ROLLING, it is strictly null!
  const currentWinNum = isResult ? roundState.rolledNumber : null;

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-zinc-100 flex flex-col justify-between pb-12 select-none relative overflow-x-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-600/30 via-zinc-950 to-black" />

      {/* 1. TOP HEADER & NAVIGATION */}
      <div className="relative z-10 px-3 py-2 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToLobby}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-semibold transition active:scale-95 shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lobby</span>
          </button>
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-500 via-amber-400 to-orange-500 flex items-center justify-center text-zinc-950 shadow-md shadow-amber-900/40 font-black text-xs">
              10
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-extrabold text-sm tracking-wide text-amber-300 font-serif">
                  Lucky 10 Live
                </span>
                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">
                Round #{roundState.roundNumber}
              </span>
            </div>
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl px-2.5 py-1 flex items-center gap-1.5 shadow-inner">
            <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-xs font-mono font-bold text-amber-300">
              ₹{parseInt(wallet?.balance || '0').toLocaleString()}
            </span>
          </div>

          <button
            onClick={() => setShowFairnessModal(true)}
            className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 flex items-center justify-center text-zinc-300 hover:text-blue-400 transition active:scale-95"
            title="Provably Fair Verification"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </button>

          <button
            onClick={() => setShowRulesModal(true)}
            className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 flex items-center justify-center text-zinc-300 hover:text-amber-400 transition active:scale-95"
            title="Rules & Payouts"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 flex items-center justify-center text-zinc-300 hover:text-amber-400 transition active:scale-95"
            title={soundEnabled ? 'Mute' : 'Unmute'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
          </button>
        </div>
      </div>

      {/* 2. SYNCHRONIZED STATUS & COUNTDOWN BAR */}
      <div className="relative z-10 px-3 py-1.5">
        <div className="flex items-center justify-between bg-zinc-900/95 border border-zinc-800/90 rounded-xl px-3 py-1.5 shadow-md">
          {/* Status Label */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {roundState.status === 'BETTING' && (
                <span className="flex items-center gap-1.5 text-emerald-400 font-extrabold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  PLACE BETS (నంబర్లు ఎంచుకోండి)
                </span>
              )}
              {roundState.status === 'ROLLING' && (
                <span className="flex items-center gap-1.5 text-amber-400 font-extrabold">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  ROLLING DICE (నంబర్ రోల్ అవుతోంది)...
                </span>
              )}
              {roundState.status === 'RESULT' && (
                <span className="flex items-center gap-1.5 text-purple-300 font-extrabold">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  WINNING NUMBER: #{roundState.rolledNumber}!
                </span>
              )}
            </span>
          </div>

          {/* Compact Countdown / Timer */}
          <div className="flex items-center gap-2">
            {roundState.status === 'BETTING' ? (
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-[10px] text-zinc-400 uppercase font-semibold">Time:</span>
                <span
                  className={`text-sm font-black font-mono tracking-tight ${
                    timeLeftSec <= 3 ? 'text-red-400 animate-pulse' : 'text-emerald-400'
                  }`}
                >
                  {timeLeftSec}s
                </span>
              </div>
            ) : (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700">
                Next round soon
              </span>
            )}

            <button
              onClick={() => setShowCommunityDrawer(!showCommunityDrawer)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/80 text-[10px] text-zinc-300 transition"
              title="View live community bets"
            >
              <Users className="w-3 h-3 text-amber-400" />
              <span>{roundState.totalBetsCount || 0}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. RECENT PAST ROUNDS TICKER STRIP (Clearly labeled as PAST RESULTS) */}
      <div className="relative z-10 px-3 py-1 bg-zinc-950/80 border-b border-zinc-800/60">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <span className="text-[10px] text-zinc-400 uppercase font-bold shrink-0 mr-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-amber-400" />
            <span>Past Results (గత రౌండ్లు):</span>
          </span>
          {history.length === 0 ? (
            <span className="text-[10px] text-zinc-600">గత రౌండ్ల నంబర్లు ఇక్కడ కనిపిస్తాయి...</span>
          ) : (
            history.map((item, idx) => (
              <div
                key={idx}
                title={`Round #${item.roundNumber}: Rolled #${item.rolledNumber} (గత ఫలితం)`}
                className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-mono font-black shrink-0 border transition transform hover:scale-110 shadow-sm ${
                  isResult && item.rolledNumber === currentWinNum && idx === 0
                    ? 'bg-amber-500/30 text-amber-300 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                    : 'bg-zinc-900 text-zinc-300 border-zinc-700'
                }`}
              >
                {item.rolledNumber}
              </div>
            ))
          )}
        </div>
      </div>

      {/* NOTIFICATIONS & ERRORS */}
      {noticeMessage && (
        <div className="relative z-30 mx-3 my-1 py-1 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg animate-fadeIn">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>{noticeMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="relative z-30 mx-3 my-1 py-1 px-3 rounded-xl bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg animate-fadeIn">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 4. CENTRAL 3D CSS DICE ANIMATION ARENA */}
      <div className="relative z-10 px-3 py-1 flex-1 flex flex-col justify-center space-y-2">
        <CssDiceArena
          isRolling={isRolling}
          rollValue={currentWinNum}
          won={isResult && currentWinNum !== null && (myBets[currentWinNum.toString()] || 0) > 0}
          status={roundState.status as 'BETTING' | 'ROLLING' | 'RESULT'}
        />

        {/* 5. PROMINENT 1 TO 10 NUMBERS SELECTION BOARD */}
        <div className="bg-zinc-950/90 border border-amber-500/30 rounded-2xl p-3 shadow-xl space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                #
              </div>
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-300 font-serif">
                Select Numbers (1 to 10) - 9x Payout
              </h3>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono">
              ₹{selectedChip} per click
            </span>
          </div>

          {/* THE 1 TO 10 NUMBERS GRID (2 ROWS OF 5) */}
          <div className="grid grid-cols-5 gap-2">
            {NUMBERS_1_TO_10.map((num) => {
              const numStr = num.toString();
              const myBetOnNum = myBets[numStr] || 0;
              // STRICT: Only highlight winning number in RESULT phase!
              const isWinningNumber = isResult && currentWinNum === num;
              const totalRoomBetOnNum = roundState.numberBetsAmount?.[numStr] || '0';

              return (
                <button
                  key={num}
                  onClick={() => handlePlaceBet(numStr)}
                  disabled={roundState.status !== 'BETTING' || isSubmittingBet}
                  className={`relative p-2.5 sm:p-3 rounded-2xl border flex flex-col items-center justify-between transition-all duration-200 active:scale-95 shadow-md ${
                    isWinningNumber
                      ? 'bg-gradient-to-b from-amber-500/50 via-emerald-600/40 to-zinc-950 border-amber-300 ring-2 ring-amber-400/90 shadow-[0_0_25px_rgba(245,158,11,0.6)] scale-105'
                      : myBetOnNum > 0
                      ? 'bg-amber-950/60 border-amber-500 ring-1 ring-amber-500/70 shadow-amber-900/40'
                      : 'bg-zinc-900/90 hover:bg-zinc-800/90 border-zinc-800 hover:border-amber-500/40 text-zinc-200'
                  } ${roundState.status !== 'BETTING' ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {/* Winning Badge (strictly in RESULT phase only) */}
                  {isWinningNumber && (
                    <span className="absolute -top-1.5 -right-1 px-1.5 py-0.2 rounded-full bg-amber-400 text-zinc-950 font-black text-[8px] uppercase shadow animate-bounce">
                      WIN
                    </span>
                  )}

                  {/* Main Number Digit */}
                  <span
                    className={`text-xl sm:text-2xl font-black font-mono leading-none ${
                      isWinningNumber
                        ? 'text-amber-200'
                        : myBetOnNum > 0
                        ? 'text-amber-400'
                        : 'text-zinc-100'
                    }`}
                  >
                    {num}
                  </span>

                  {/* Payout Tag */}
                  <span className="text-[9px] text-zinc-400 font-mono font-bold mt-0.5">
                    9x
                  </span>

                  {/* Active Bet Chip on this Number */}
                  {myBetOnNum > 0 && (
                    <div className="mt-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 font-mono font-extrabold text-[9px] shadow animate-scaleUp">
                      ₹{myBetOnNum}
                    </div>
                  )}

                  {/* Room Total Bet Indicator */}
                  {parseInt(totalRoomBetOnNum) > 0 && myBetOnNum === 0 && (
                    <span className="text-[8px] font-mono text-zinc-500 mt-1">
                      ₹{parseInt(totalRoomBetOnNum).toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* QUICK GROUP BETS: SMALL (1-5), BIG (6-10), EVEN, ODD (2x Payout) */}
          <div className="grid grid-cols-4 gap-1.5 pt-1 border-t border-zinc-850">
            {/* Small (1-5) */}
            <button
              onClick={() => handlePlaceBet('small')}
              disabled={roundState.status !== 'BETTING' || isSubmittingBet}
              className={`p-1.5 rounded-xl border flex flex-col items-center justify-center transition active:scale-95 ${
                (myBets['small'] || 0) > 0
                  ? 'bg-blue-950/70 border-blue-500 text-blue-300 ring-1 ring-blue-500/50'
                  : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
              } ${roundState.status !== 'BETTING' ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="text-[11px] font-bold">1 - 5 (Small)</span>
              <span className="text-[9px] font-mono text-zinc-400">2x Payout</span>
              {(myBets['small'] || 0) > 0 && (
                <span className="text-[9px] font-mono font-bold text-amber-300">
                  ₹{myBets['small']}
                </span>
              )}
            </button>

            {/* Big (6-10) */}
            <button
              onClick={() => handlePlaceBet('big')}
              disabled={roundState.status !== 'BETTING' || isSubmittingBet}
              className={`p-1.5 rounded-xl border flex flex-col items-center justify-center transition active:scale-95 ${
                (myBets['big'] || 0) > 0
                  ? 'bg-orange-950/70 border-orange-500 text-orange-300 ring-1 ring-orange-500/50'
                  : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
              } ${roundState.status !== 'BETTING' ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="text-[11px] font-bold">6 - 10 (Big)</span>
              <span className="text-[9px] font-mono text-zinc-400">2x Payout</span>
              {(myBets['big'] || 0) > 0 && (
                <span className="text-[9px] font-mono font-bold text-amber-300">
                  ₹{myBets['big']}
                </span>
              )}
            </button>

            {/* Even */}
            <button
              onClick={() => handlePlaceBet('even')}
              disabled={roundState.status !== 'BETTING' || isSubmittingBet}
              className={`p-1.5 rounded-xl border flex flex-col items-center justify-center transition active:scale-95 ${
                (myBets['even'] || 0) > 0
                  ? 'bg-purple-950/70 border-purple-500 text-purple-300 ring-1 ring-purple-500/50'
                  : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
              } ${roundState.status !== 'BETTING' ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="text-[11px] font-bold">EVEN</span>
              <span className="text-[9px] font-mono text-zinc-400">2x Payout</span>
              {(myBets['even'] || 0) > 0 && (
                <span className="text-[9px] font-mono font-bold text-amber-300">
                  ₹{myBets['even']}
                </span>
              )}
            </button>

            {/* Odd */}
            <button
              onClick={() => handlePlaceBet('odd')}
              disabled={roundState.status !== 'BETTING' || isSubmittingBet}
              className={`p-1.5 rounded-xl border flex flex-col items-center justify-center transition active:scale-95 ${
                (myBets['odd'] || 0) > 0
                  ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/50'
                  : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
              } ${roundState.status !== 'BETTING' ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="text-[11px] font-bold">ODD</span>
              <span className="text-[9px] font-mono text-zinc-400">2x Payout</span>
              {(myBets['odd'] || 0) > 0 && (
                <span className="text-[9px] font-mono font-bold text-amber-300">
                  ₹{myBets['odd']}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 6. CHIP SELECTOR & ACTIONS TRAY */}
      <div className="relative z-10 px-3 py-2 space-y-2 bg-zinc-950/95 border-t border-zinc-800/80 backdrop-blur-md">
        {/* Chip Denominations row */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          {CHIP_DENOMINATIONS.map((chip) => (
            <button
              key={chip}
              onClick={() => {
                setSelectedChip(chip);
                diceAudio.playChipSound();
              }}
              className={`flex-1 min-w-[44px] py-1.5 rounded-xl border flex flex-col items-center justify-center transition active:scale-90 ${
                selectedChip === chip
                  ? 'bg-gradient-to-t from-amber-600 via-amber-500 to-amber-400 text-zinc-950 font-black border-amber-300 shadow-md shadow-amber-500/30 scale-105'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <div className="w-4 h-4 rounded-full border border-dashed border-current flex items-center justify-center mb-0.5">
                <span className="text-[7px] font-mono font-bold">₹</span>
              </div>
              <span className="text-[10px] font-mono font-bold leading-none">
                {chip >= 1000 ? `${chip / 1000}k` : chip}
              </span>
            </button>
          ))}
        </div>

        {/* Quick Action Buttons: Select All, Double, Rebet */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDoubleBets}
              disabled={roundState.status !== 'BETTING' || totalMyBetAmount === 0 || isSubmittingBet}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-amber-400 hover:text-amber-300 hover:bg-zinc-800 disabled:opacity-40 transition active:scale-95 text-[11px] font-semibold"
            >
              2x Double
            </button>
            <button
              onClick={handleSelectAll}
              disabled={roundState.status !== 'BETTING' || isSubmittingBet}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition active:scale-95 text-[11px] font-semibold"
            >
              All 1-10
            </button>
            <button
              onClick={handleRebet}
              disabled={roundState.status !== 'BETTING' || isSubmittingBet || Object.keys(lastRoundBets).length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition active:scale-95 text-[11px] font-semibold"
            >
              <RotateCcw className="w-3 h-3 text-emerald-400" />
              <span>Rebet</span>
            </button>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-zinc-500 uppercase font-bold block">Current Bet</span>
            <span className="text-sm font-mono font-extrabold text-amber-400">
              ₹{totalMyBetAmount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* 7. LIVE COMMUNITY BETS DRAWER */}
      {showCommunityDrawer && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex justify-end animate-fadeIn">
          <div className="w-80 max-w-[85vw] h-full bg-zinc-950 border-l border-zinc-800 p-4 flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-sm text-zinc-100">Live Player Bets</h3>
                </div>
                <button
                  onClick={() => setShowCommunityDrawer(false)}
                  className="w-7 h-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3 space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {liveBets.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-8">
                    Waiting for round bets to roll in...
                  </p>
                ) : (
                  liveBets.map((bet) => (
                    <div
                      key={bet.id}
                      className="flex items-center justify-between p-2 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-[10px] text-amber-400">
                          {bet.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-semibold text-zinc-200 block leading-tight">
                            {bet.username}
                          </span>
                          <span className="text-[9px] font-bold uppercase text-amber-400">
                            Number #{bet.type}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-zinc-100">
                        ₹{parseInt(bet.amount).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 text-center text-[11px] text-zinc-500 font-mono">
              Lucky 10 Continuous Engine v3.2
            </div>
          </div>
        </div>
      )}

      {/* 8. RULES & PAYOUTS MODAL (TELUGU & ENGLISH) */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 animate-fadeIn">
          <div className="w-full max-w-lg bg-zinc-950 border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center font-black">
                  10
                </div>
                <div>
                  <h3 className="font-serif font-black text-base text-amber-300">
                    Lucky 10 Live - Rules & Guide
                  </h3>
                  <p className="text-[10px] text-zinc-400">ఆన్‌లైన్ సింక్రొనైజ్డ్ రౌండ్ నియమాలు</p>
                </div>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1.5 py-2.5 border-b border-zinc-800 overflow-x-auto scrollbar-none">
              {(['rules', 'payouts', 'provablyFair', 'faq'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveRulesTab(tab)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition capitalize ${
                    activeRulesTab === tab
                      ? 'bg-amber-500 text-zinc-950 shadow-md'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab === 'rules' && 'Game Rules (నియమాలు)'}
                  {tab === 'payouts' && 'Payouts (పేమెంట్)'}
                  {tab === 'provablyFair' && 'Provably Fair'}
                  {tab === 'faq' && 'FAQ'}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto py-3 text-xs text-zinc-300 space-y-3 pr-1">
              {activeRulesTab === 'rules' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1">1. ఆన్‌లైన్ సింక్రొనైజ్డ్ రౌండ్ (Single Shared Round)</h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      ఎంతమంది ఆటగాళ్లు వచ్చినా అందరూ ఒకే లైవ్ సర్వర్ రౌండ్‌కి కనెక్ట్ అవుతారు. ప్రతి రౌండ్‌లో 14 సెకన్ల పాటు బెట్ వేసుకోవచ్చు. టైమర్ ముగిసిన వెంటనే డైస్ రోల్ అయ్యి ఫలితం వస్తుంది.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1">2. ఎగ్జాక్ట్ నంబర్ విన్ (Exact Number - 9x Payout)</h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      మీరు 1 నుండి 10 నంబర్లలో నచ్చిన నంబర్‌ను ఎంచుకోవచ్చు. ఉదాహరణకు <strong>7</strong> పై ₹100 వేసి, డైస్ రోల్ చేసినప్పుడు <strong>7</strong> వస్తే మీకు <strong>9 రెట్లు (₹900)</strong> పేఔట్ లభిస్తుంది!
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1">3. సీక్రెట్ షేకర్ (Zero Leakage)</h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      బెట్టింగ్ సమయంలో డైస్ గోల్డెన్ షేకర్ కవర్‌లో రహస్యంగా సీల్ చేయబడి ఉంటాయి. రోల్ పూర్తయ్యేంతవరకు తదుపరి నంబర్ ఎవరికీ కనిపించదు.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1">4. గ్రూప్ బెట్స్ (Small, Big, Even, Odd - 2x Payout)</h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      • <strong>1 - 5 (Small)</strong>: 1, 2, 3, 4, 5 లలో ఏ నంబర్ వచ్చినా 2x పేమెంట్.<br />
                      • <strong>6 - 10 (Big)</strong>: 6, 7, 8, 9, 10 లలో ఏ నంబర్ వచ్చినా 2x పేమెంట్.<br />
                      • <strong>EVEN</strong>: 2, 4, 6, 8, 10 సరి సంఖ్యలు వస్తే 2x పేమెంట్.<br />
                      • <strong>ODD</strong>: 1, 3, 5, 7, 9 బేసి సంఖ్యలు వస్తే 2x పేమెంట్.
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'payouts' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 font-bold text-zinc-400 text-[11px]">
                    <span>Bet Type</span>
                    <span>Payout</span>
                    <span>Winning Numbers</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-900/40 text-[11px] items-center">
                    <span className="font-bold text-amber-400">Single Number (1-10)</span>
                    <span className="font-mono font-bold text-white">9 : 1 (9x)</span>
                    <span className="text-zinc-300">మీరు ఎంచుకున్న ఖచ్చితమైన నంబర్</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-blue-950/40 border border-blue-900/40 text-[11px] items-center">
                    <span className="font-bold text-blue-400">1 - 5 (Small)</span>
                    <span className="font-mono font-bold text-white">2 : 1 (2x)</span>
                    <span className="text-zinc-300">1, 2, 3, 4, 5</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-orange-950/40 border border-orange-900/40 text-[11px] items-center">
                    <span className="font-bold text-orange-400">6 - 10 (Big)</span>
                    <span className="font-mono font-bold text-white">2 : 1 (2x)</span>
                    <span className="text-zinc-300">6, 7, 8, 9, 10</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-purple-950/40 border border-purple-900/40 text-[11px] items-center">
                    <span className="font-bold text-purple-400">EVEN</span>
                    <span className="font-mono font-bold text-white">2 : 1 (2x)</span>
                    <span className="text-zinc-300">2, 4, 6, 8, 10</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-900/40 text-[11px] items-center">
                    <span className="font-bold text-emerald-400">ODD</span>
                    <span className="font-mono font-bold text-white">2 : 1 (2x)</span>
                    <span className="text-zinc-300">1, 3, 5, 7, 9</span>
                  </div>
                </div>
              )}

              {activeRulesTab === 'provablyFair' && (
                <div className="space-y-3 text-[11px]">
                  <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h4 className="font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Provably Fair 1 to 10 నిష్పక్షపాత విధానం</span>
                    </h4>
                    <p className="leading-relaxed text-zinc-300">
                      ప్రతి రౌండ్‌లో వచ్చే 1 నుండి 10 సంఖ్యలు <strong>HMAC-SHA256</strong> క్రిప్టోగ్రాఫిక్ అల్గోరిథం ద్వారా సర్వర్ సీడ్ మరియు క్లయింట్ సీడ్‌తో మాత్రమే రోల్ ముగిసిన వెంటనే లెక్కించబడతాయి. బెట్టింగ్ సమయంలో ఫలితం ఎవరికీ తెలియదు.
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'faq' && (
                <div className="space-y-2.5 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h5 className="font-bold text-amber-400 mb-0.5">రౌండ్ ఆటోమేటిక్‌గా జరుగుతుందా?</h5>
                    <p className="text-zinc-300">అవును, సర్వర్ నిరంతరంగా ప్రతి 14 సెకన్లకు ఒక రౌండ్‌ను నడుపుతుంది. ఎంతమంది ప్లేయర్స్ కనెక్ట్ అయినా అందరూ ఒకే రౌండ్‌లో ఆడతారు.</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h5 className="font-bold text-amber-400 mb-0.5">తదుపరి నంబర్ ముందే తెలుస్తుందా?</h5>
                    <p className="text-zinc-300">లేదు, క్రిప్టోగ్రాఫిక్ నిబంధనల ప్రకారం బెట్టింగ్ ముగిసి రోల్ అయ్యే వరకు ఫలితం సీల్ చేయబడి ఉంటుంది.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowRulesModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition active:scale-95"
              >
                అర్థమైంది (Close)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. PROVABLY FAIR VERIFICATION MODAL */}
      {showFairnessModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 animate-fadeIn">
          <div className="w-full max-w-md bg-zinc-950 border border-emerald-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-zinc-100">Provably Fair Verification</h3>
              </div>
              <button
                onClick={() => setShowFairnessModal(false)}
                className="w-7 h-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">
                  Active Server Seed (SHA-256 Hash)
                </label>
                <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-emerald-300 break-all select-all">
                  {roundState.id}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">
                  Client Seed
                </label>
                <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-200">
                  client-seed-live
                </div>
              </div>

              <div className="flex items-center justify-between text-xs p-2 rounded-xl bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-400">Current Round:</span>
                <span className="font-mono font-bold text-amber-400">#{roundState.roundNumber}</span>
              </div>
            </div>

            {/* Independent Verifier */}
            <div className="pt-2 border-t border-zinc-800 space-y-2">
              <span className="text-[11px] font-bold text-zinc-300 block">Verify Any Past 1-10 Roll:</span>
              <input
                type="text"
                placeholder="Server Seed (Revealed)"
                value={verifyServerSeed}
                onChange={(e) => setVerifyServerSeed(e.target.value)}
                className="w-full p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-200"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Client Seed"
                  value={verifyClientSeed}
                  onChange={(e) => setVerifyClientSeed(e.target.value)}
                  className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-200"
                />
                <input
                  type="number"
                  placeholder="Round / Nonce"
                  value={verifyNonce}
                  onChange={(e) => setVerifyNonce(parseInt(e.target.value) || 1)}
                  className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-200"
                />
              </div>

              <button
                onClick={handleVerify}
                className="w-full py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition"
              >
                Compute & Verify 1-10 Result
              </button>

              {verifyResult !== null && (
                <div className="p-2 rounded-xl bg-emerald-950/60 border border-emerald-500 text-center font-mono font-bold text-emerald-300 text-xs">
                  Result: #{verifyResult}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowFairnessModal(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
