import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Sparkles,
  HelpCircle,
  Trophy,
  Coins,
  Crown,
  X,
  AlertCircle,
  Flame,
  Zap,
  Users,
  RotateCcw,
  History,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { ApiClient } from '../../api/client';
import {
  Card,
  SUIT_SYMBOLS,
  SUIT_COLORS,
  getRankLabel,
} from '../../../../shared/src/utils/teenPatti';
import { dragonTigerAudio } from './DragonTigerAudio';

const CHIP_DENOMINATIONS = [10, 50, 100, 500, 1000, 5000];

// Rank display helper for Dragon Tiger (Ace is 1, King is 13)
function getDragonTigerRankName(rank: number): string {
  if (rank === 14 || rank === 1) return 'Ace (1)';
  if (rank === 11) return 'Jack (11)';
  if (rank === 12) return 'Queen (12)';
  if (rank === 13) return 'King (13)';
  return rank.toString();
}

function getCardValueForComparison(rank: number): number {
  return rank === 14 ? 1 : rank;
}

export const DragonTigerGame: React.FC<{ onBackToLobby: () => void }> = ({ onBackToLobby }) => {
  const { user, wallet, refreshWallet } = useAuth();
  const {
    isConnected,
    dragonTigerRound,
    dragonTigerHistory,
    dragonTigerLiveBets,
  } = useWebSocket();

  // Audio & Modals
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [activeRulesTab, setActiveRulesTab] = useState<'rules' | 'payouts' | 'rankings' | 'faq'>('rules');
  const [showCommunityDrawer, setShowCommunityDrawer] = useState<boolean>(false);

  // Betting State
  const [selectedChip, setSelectedChip] = useState<number>(50);
  const [myBets, setMyBets] = useState<Record<string, number>>({});
  const [lastRoundBets, setLastRoundBets] = useState<Record<string, number>>({});
  const [isSubmittingBet, setIsSubmittingBet] = useState<boolean>(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live Timer Countdown Seconds
  const [timeLeftSec, setTimeLeftSec] = useState<number>(12);
  const lastRoundIdRef = useRef<string | null>(null);
  const lastResultFiredRef = useRef<string | null>(null);

  // Sound sync
  useEffect(() => {
    dragonTigerAudio.enabled = soundEnabled;
  }, [soundEnabled]);

  // Synchronized Countdown Timer (calculated from server bettingEndsAt)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (dragonTigerRound.status === 'BETTING') {
        const diff = Math.max(0, Math.ceil((dragonTigerRound.bettingEndsAt - now) / 1000));
        setTimeLeftSec(diff);
        if (diff <= 3 && diff > 0) {
          dragonTigerAudio.playTick();
        }
      } else {
        setTimeLeftSec(0);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [dragonTigerRound.status, dragonTigerRound.bettingEndsAt]);

  // Round transition handling
  useEffect(() => {
    if (dragonTigerRound.id !== lastRoundIdRef.current) {
      lastRoundIdRef.current = dragonTigerRound.id;
      if (dragonTigerRound.status === 'BETTING') {
        // Save previous round bets for rebet
        if (Object.keys(myBets).length > 0) {
          setLastRoundBets(myBets);
        }
        setMyBets({});
        lastResultFiredRef.current = null;
      }
    }

    // Play deal sound on transition to revealing
    if (dragonTigerRound.status === 'REVEALING') {
      dragonTigerAudio.playDealSound();
      setTimeout(() => dragonTigerAudio.playFlipSound(), 600);
      setTimeout(() => dragonTigerAudio.playFlipSound(), 1400);
    }

    // Play victory sound & fanfare if result settled
    if (dragonTigerRound.status === 'RESULT' && dragonTigerRound.winner && lastResultFiredRef.current !== dragonTigerRound.id) {
      lastResultFiredRef.current = dragonTigerRound.id;

      if (dragonTigerRound.winner === 'dragon') {
        dragonTigerAudio.playDragonVictory();
      } else if (dragonTigerRound.winner === 'tiger') {
        dragonTigerAudio.playTigerVictory();
      } else {
        dragonTigerAudio.playTieSound();
      }

      // Check if user won
      let userWon = false;
      const w = dragonTigerRound.winner;

      if ((w === 'dragon' && (myBets['dragon'] || 0) > 0) ||
          (w === 'tiger' && (myBets['tiger'] || 0) > 0) ||
          ((w === 'tie' || w === 'suited_tie') && (myBets['tie'] || 0) > 0) ||
          (w === 'suited_tie' && (myBets['suited_tie'] || 0) > 0)) {
        userWon = true;
      }

      // Check side bets
      if (dragonTigerRound.dragonCard && dragonTigerRound.tigerCard) {
        const dVal = getCardValueForComparison(dragonTigerRound.dragonCard.rank);
        const tVal = getCardValueForComparison(dragonTigerRound.tigerCard.rank);
        if (dVal >= 8 && dVal !== 7 && (myBets['dragon_big'] || 0) > 0) userWon = true;
        if (dVal <= 6 && (myBets['dragon_small'] || 0) > 0) userWon = true;
        if (tVal >= 8 && tVal !== 7 && (myBets['tiger_big'] || 0) > 0) userWon = true;
        if (tVal <= 6 && (myBets['tiger_small'] || 0) > 0) userWon = true;
      }

      if (userWon) {
        dragonTigerAudio.playWinFanfare();
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ffd700'],
        });
        refreshWallet();
      }
    }
  }, [dragonTigerRound.id, dragonTigerRound.status, dragonTigerRound.winner]);

  const showNotification = (msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => setNoticeMessage(null), 3000);
  };

  // Place bet on Dragon, Tiger, Tie, Suited Tie, or Side Bet
  const handlePlaceBet = async (side: string) => {
    if (dragonTigerRound.status !== 'BETTING') {
      setErrorMessage('Betting is closed for this round. Please wait for next round.');
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }

    dragonTigerAudio.playChipSound();
    setIsSubmittingBet(true);
    setErrorMessage(null);

    const betAmountStr = selectedChip.toString();

    try {
      await ApiClient.placeDragonTigerBet({
        bets: [{ type: side, amount: betAmountStr }],
      });

      setMyBets((prev) => ({
        ...prev,
        [side]: (prev[side] || 0) + selectedChip,
      }));

      showNotification(`₹${selectedChip} placed on ${side.replace('_', ' ').toUpperCase()}!`);
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error placing bet');
      setTimeout(() => setErrorMessage(null), 3500);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  // Double current bets
  const handleDoubleBets = async () => {
    if (dragonTigerRound.status !== 'BETTING') return;
    const currentKeys = Object.keys(myBets).filter((k) => myBets[k] > 0);
    if (currentKeys.length === 0) {
      setErrorMessage('No bets to double.');
      setTimeout(() => setErrorMessage(null), 2000);
      return;
    }

    const additionalBets = currentKeys.map((k) => ({
      type: k,
      amount: myBets[k].toString(),
    }));

    setIsSubmittingBet(true);
    try {
      await ApiClient.placeDragonTigerBet({ bets: additionalBets });
      setMyBets((prev) => {
        const updated = { ...prev };
        currentKeys.forEach((k) => {
          updated[k] = updated[k] * 2;
        });
        return updated;
      });
      dragonTigerAudio.playChipSound();
      showNotification('Bets doubled!');
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
    if (dragonTigerRound.status !== 'BETTING') return;
    const rebetKeys = Object.keys(lastRoundBets).filter((k) => lastRoundBets[k] > 0);
    if (rebetKeys.length === 0) {
      setErrorMessage('No previous round bets found.');
      setTimeout(() => setErrorMessage(null), 2000);
      return;
    }

    const betsToPlace = rebetKeys.map((k) => ({
      type: k,
      amount: lastRoundBets[k].toString(),
    }));

    setIsSubmittingBet(true);
    try {
      await ApiClient.placeDragonTigerBet({ bets: betsToPlace });
      setMyBets((prev) => {
        const next = { ...prev };
        rebetKeys.forEach((k) => {
          next[k] = (next[k] || 0) + lastRoundBets[k];
        });
        return next;
      });
      dragonTigerAudio.playChipSound();
      showNotification('Previous bets repeated!');
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not repeat bets');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  const totalMyBetAmount = Object.values(myBets).reduce((acc, v) => acc + v, 0);

  // Roadmap Statistics calculation
  const totalRounds = dragonTigerHistory.length || 1;
  const dragonWins = dragonTigerHistory.filter((h) => h.winner === 'dragon').length;
  const tigerWins = dragonTigerHistory.filter((h) => h.winner === 'tiger').length;
  const tieWins = dragonTigerHistory.filter((h) => h.winner === 'tie' || h.winner === 'suited_tie').length;
  const dragonPct = Math.round((dragonWins / totalRounds) * 100);
  const tigerPct = Math.round((tigerWins / totalRounds) * 100);
  const tiePct = Math.round((tieWins / totalRounds) * 100);

  const dCard = dragonTigerRound.dragonCard;
  const tCard = dragonTigerRound.tigerCard;
  const isRevealingOrResult = dragonTigerRound.status === 'REVEALING' || dragonTigerRound.status === 'RESULT';

  const dVal = dCard ? getCardValueForComparison(dCard.rank) : 0;
  const tVal = tCard ? getCardValueForComparison(tCard.rank) : 0;

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-zinc-100 flex flex-col justify-between pb-12 select-none relative overflow-x-hidden">
      {/* BACKGROUND AURA */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-600/30 via-red-950/20 to-black" />

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
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-red-600 via-amber-500 to-amber-400 flex items-center justify-center text-white shadow-md shadow-red-900/40 font-black text-xs">
              DT
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-extrabold text-sm tracking-wide text-amber-300 font-serif">
                  Dragon Tiger Live
                </span>
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">
                Round #{dragonTigerRound.roundNumber}
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

      {/* 2. COMPACT COUNTDOWN & STATUS BAR (CHINADHI COUNTDOWN) */}
      <div className="relative z-10 px-3 py-1.5">
        <div className="flex items-center justify-between bg-zinc-900/95 border border-zinc-800/90 rounded-xl px-3 py-1.5 shadow-md">
          {/* Status Label */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {dragonTigerRound.status === 'BETTING' && (
                <span className="flex items-center gap-1.5 text-emerald-400 font-extrabold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  PLACE YOUR BETS
                </span>
              )}
              {dragonTigerRound.status === 'REVEALING' && (
                <span className="flex items-center gap-1.5 text-amber-400 font-extrabold">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  REVEALING CARDS...
                </span>
              )}
              {dragonTigerRound.status === 'RESULT' && (
                <span className="flex items-center gap-1.5 text-purple-300 font-extrabold">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  {dragonTigerRound.winner === 'dragon' && '🔥 DRAGON WINS!'}
                  {dragonTigerRound.winner === 'tiger' && '⚡ TIGER WINS!'}
                  {dragonTigerRound.winner === 'tie' && '🤝 TIE (8:1)!'}
                  {dragonTigerRound.winner === 'suited_tie' && '👑 SUITED TIE (50:1)!'}
                </span>
              )}
            </span>
          </div>

          {/* Compact Countdown / Timer */}
          <div className="flex items-center gap-2">
            {dragonTigerRound.status === 'BETTING' ? (
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
            >
              <Users className="w-3 h-3 text-amber-400" />
              <span>{dragonTigerRound.totalBetsCount || 0}</span>
            </button>
          </div>
        </div>
      </div>

      {/* NOTIFICATIONS & ERRORS */}
      {noticeMessage && (
        <div className="relative z-30 mx-3 py-1.5 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg animate-fadeIn">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>{noticeMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="relative z-30 mx-3 py-1.5 px-3 rounded-xl bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg animate-fadeIn">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3. CENTRAL LIVE CASINO CARD CLASH ARENA */}
      <div className="relative z-10 px-3 py-1 flex-1 flex flex-col justify-center">
        <div className="relative rounded-2xl bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 border border-amber-500/30 p-3 sm:p-4 shadow-2xl overflow-hidden">
          {/* Subtle gold felt border ring */}
          <div className="absolute inset-0 border border-amber-500/10 rounded-2xl pointer-events-none" />

          {/* Dragon vs Tiger Face-Off Area */}
          <div className="grid grid-cols-2 gap-3 sm:gap-6 relative">
            {/* Center VS Clash Badge */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-zinc-950 border-2 border-amber-500/70 shadow-lg flex items-center justify-center">
                <span className="text-[10px] font-black text-amber-400 tracking-tighter">VS</span>
              </div>
            </div>

            {/* --- DRAGON CARD ZONE --- */}
            <div
              className={`rounded-xl p-3 flex flex-col items-center justify-between border transition-all duration-300 relative ${
                dragonTigerRound.status === 'RESULT' && dragonTigerRound.winner === 'dragon'
                  ? 'bg-red-950/60 border-red-500 shadow-[0_0_25px_rgba(239,68,68,0.4)] scale-[1.02]'
                  : 'bg-gradient-to-b from-red-950/20 to-zinc-900/60 border-red-900/40'
              }`}
            >
              {/* Dragon Header */}
              <div className="w-full flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-lg bg-red-600/30 border border-red-500/40 flex items-center justify-center text-red-400">
                    <Flame className="w-3.5 h-3.5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black tracking-wider text-red-400 font-serif">DRAGON</h3>
                    <span className="text-[9px] text-zinc-400 font-mono">1 : 1 Payout</span>
                  </div>
                </div>
                {dragonTigerRound.status === 'RESULT' && dragonTigerRound.winner === 'dragon' && (
                  <span className="px-1.5 py-0.5 rounded bg-red-500 text-white font-extrabold text-[9px] animate-bounce shadow">
                    WINNER
                  </span>
                )}
              </div>

              {/* Dragon Card Slot */}
              <div className="my-2 flex flex-col items-center">
                {isRevealingOrResult && dCard ? (
                  <div className="w-20 h-28 sm:w-24 sm:h-34 rounded-xl bg-white text-zinc-900 shadow-2xl border-2 border-red-500/70 flex flex-col justify-between p-2 transform transition-all duration-500 hover:scale-105 animate-scaleUp">
                    <div className="flex items-start justify-between">
                      <span
                        className="text-base font-black leading-none font-mono"
                        style={{ color: SUIT_COLORS[dCard.suit] }}
                      >
                        {getRankLabel(dCard.rank)}
                      </span>
                      <span className="text-base" style={{ color: SUIT_COLORS[dCard.suit] }}>
                        {SUIT_SYMBOLS[dCard.suit]}
                      </span>
                    </div>

                    <div
                      className="text-3xl sm:text-4xl self-center font-bold"
                      style={{ color: SUIT_COLORS[dCard.suit] }}
                    >
                      {SUIT_SYMBOLS[dCard.suit]}
                    </div>

                    <div className="flex items-end justify-between rotate-180">
                      <span
                        className="text-base font-black leading-none font-mono"
                        style={{ color: SUIT_COLORS[dCard.suit] }}
                      >
                        {getRankLabel(dCard.rank)}
                      </span>
                      <span className="text-base" style={{ color: SUIT_COLORS[dCard.suit] }}>
                        {SUIT_SYMBOLS[dCard.suit]}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-28 sm:w-24 sm:h-34 rounded-xl bg-gradient-to-br from-red-950 via-zinc-900 to-black border-2 border-dashed border-red-700/60 flex flex-col items-center justify-center p-2 shadow-inner">
                    <div className="w-9 h-9 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500 mb-1">
                      <Flame className="w-5 h-5 text-red-400" />
                    </div>
                    <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">
                      {dragonTigerRound.status === 'BETTING' ? 'Card Ready' : 'Dealing...'}
                    </span>
                  </div>
                )}

                {/* Card Score Label */}
                <div className="mt-1.5 text-center">
                  {isRevealingOrResult && dCard ? (
                    <span className="text-[11px] font-bold text-red-300 font-mono">
                      {getDragonTigerRankName(dCard.rank)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500">Waiting Deal</span>
                  )}
                </div>
              </div>

              {/* Pool on Dragon */}
              <div className="w-full pt-1.5 border-t border-red-900/30 flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">Total Bets:</span>
                <span className="font-mono font-bold text-red-400">
                  ₹{parseInt(dragonTigerRound.dragonBetAmount || '0').toLocaleString()}
                </span>
              </div>
            </div>

            {/* --- TIGER CARD ZONE --- */}
            <div
              className={`rounded-xl p-3 flex flex-col items-center justify-between border transition-all duration-300 relative ${
                dragonTigerRound.status === 'RESULT' && dragonTigerRound.winner === 'tiger'
                  ? 'bg-amber-950/60 border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.4)] scale-[1.02]'
                  : 'bg-gradient-to-b from-amber-950/20 to-zinc-900/60 border-amber-900/40'
              }`}
            >
              {/* Tiger Header */}
              <div className="w-full flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-lg bg-amber-600/30 border border-amber-500/40 flex items-center justify-center text-amber-400">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black tracking-wider text-amber-400 font-serif">TIGER</h3>
                    <span className="text-[9px] text-zinc-400 font-mono">1 : 1 Payout</span>
                  </div>
                </div>
                {dragonTigerRound.status === 'RESULT' && dragonTigerRound.winner === 'tiger' && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500 text-black font-extrabold text-[9px] animate-bounce shadow">
                    WINNER
                  </span>
                )}
              </div>

              {/* Tiger Card Slot */}
              <div className="my-2 flex flex-col items-center">
                {isRevealingOrResult && tCard ? (
                  <div className="w-20 h-28 sm:w-24 sm:h-34 rounded-xl bg-white text-zinc-900 shadow-2xl border-2 border-amber-500/70 flex flex-col justify-between p-2 transform transition-all duration-500 hover:scale-105 animate-scaleUp">
                    <div className="flex items-start justify-between">
                      <span
                        className="text-base font-black leading-none font-mono"
                        style={{ color: SUIT_COLORS[tCard.suit] }}
                      >
                        {getRankLabel(tCard.rank)}
                      </span>
                      <span className="text-base" style={{ color: SUIT_COLORS[tCard.suit] }}>
                        {SUIT_SYMBOLS[tCard.suit]}
                      </span>
                    </div>

                    <div
                      className="text-3xl sm:text-4xl self-center font-bold"
                      style={{ color: SUIT_COLORS[tCard.suit] }}
                    >
                      {SUIT_SYMBOLS[tCard.suit]}
                    </div>

                    <div className="flex items-end justify-between rotate-180">
                      <span
                        className="text-base font-black leading-none font-mono"
                        style={{ color: SUIT_COLORS[tCard.suit] }}
                      >
                        {getRankLabel(tCard.rank)}
                      </span>
                      <span className="text-base" style={{ color: SUIT_COLORS[tCard.suit] }}>
                        {SUIT_SYMBOLS[tCard.suit]}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-28 sm:w-24 sm:h-34 rounded-xl bg-gradient-to-br from-amber-950 via-zinc-900 to-black border-2 border-dashed border-amber-700/60 flex flex-col items-center justify-center p-2 shadow-inner">
                    <div className="w-9 h-9 rounded-full bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-1">
                      <Zap className="w-5 h-5 text-amber-400" />
                    </div>
                    <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">
                      {dragonTigerRound.status === 'BETTING' ? 'Card Ready' : 'Dealing...'}
                    </span>
                  </div>
                )}

                {/* Card Score Label */}
                <div className="mt-1.5 text-center">
                  {isRevealingOrResult && tCard ? (
                    <span className="text-[11px] font-bold text-amber-300 font-mono">
                      {getDragonTigerRankName(tCard.rank)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500">Waiting Deal</span>
                  )}
                </div>
              </div>

              {/* Pool on Tiger */}
              <div className="w-full pt-1.5 border-t border-amber-900/30 flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">Total Bets:</span>
                <span className="font-mono font-bold text-amber-400">
                  ₹{parseInt(dragonTigerRound.tigerBetAmount || '0').toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Tie Clash Result Announcement Bar */}
          {dragonTigerRound.status === 'RESULT' && (dragonTigerRound.winner === 'tie' || dragonTigerRound.winner === 'suited_tie') && (
            <div className="mt-2 text-center py-1.5 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/60 shadow-lg animate-pulse">
              <span className="text-xs font-black text-emerald-300 tracking-wider font-serif">
                {dragonTigerRound.winner === 'suited_tie' ? '👑 SUITED TIE HIT! 50:1 PAYOUT!' : '🤝 TIE ROUND! 8:1 PAYOUT!'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 4. REAL-TIME ROADMAP / BEAD PLATE / STREAKS */}
      <div className="relative z-10 px-3 py-1">
        <div className="bg-zinc-950/90 border border-zinc-800/80 rounded-xl p-2 shadow-sm">
          <div className="flex items-center justify-between mb-1.5 text-[10px]">
            <span className="font-bold text-zinc-400 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-amber-400" />
              <span>Roadmap (Last {dragonTigerHistory.length} Rounds)</span>
            </span>
            <div className="flex items-center gap-2 font-mono text-[9px]">
              <span className="text-red-400">D: {dragonPct}%</span>
              <span className="text-amber-400">T: {tigerPct}%</span>
              <span className="text-emerald-400">Tie: {tiePct}%</span>
            </div>
          </div>

          {/* Bead Plate row */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {dragonTigerHistory.map((item, idx) => {
              const isDragon = item.winner === 'dragon';
              const isTiger = item.winner === 'tiger';
              const isTie = item.winner === 'tie' || item.winner === 'suited_tie';
              return (
                <div
                  key={idx}
                  title={`Round #${item.roundNumber}: ${item.winner.toUpperCase()} (D:${getRankLabel(item.dragonCard.rank)} vs T:${getRankLabel(item.tigerCard.rank)})`}
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black border shadow-sm transition transform hover:scale-110 ${
                    isDragon
                      ? 'bg-red-600/30 text-red-300 border-red-500/70'
                      : isTiger
                      ? 'bg-amber-600/30 text-amber-300 border-amber-500/70'
                      : 'bg-emerald-600/30 text-emerald-300 border-emerald-500/70'
                  }`}
                >
                  {isDragon ? 'D' : isTiger ? 'T' : 'Tie'}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. INTERACTIVE BETTING BOARD (MAIN & SIDE BETS) */}
      <div className="relative z-10 px-3 py-1 space-y-2">
        {/* Main 4 Betting Spots: DRAGON, TIE, SUITED TIE, TIGER */}
        <div className="grid grid-cols-4 gap-1.5">
          {/* DRAGON SPOT */}
          <button
            onClick={() => handlePlaceBet('dragon')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`col-span-1 rounded-xl p-2 border flex flex-col items-center justify-between transition-all duration-200 active:scale-95 relative overflow-hidden ${
              (myBets['dragon'] || 0) > 0
                ? 'bg-red-950/80 border-red-500 ring-2 ring-red-500/50 shadow-lg'
                : 'bg-zinc-900/90 hover:bg-zinc-800/90 border-red-900/40 hover:border-red-500/60'
            } ${dragonTigerRound.status !== 'BETTING' ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-black text-red-400 font-serif">DRAGON</span>
            </div>
            <span className="text-[9px] text-zinc-400 font-mono">1 : 1</span>

            {/* My Placed Chips on Dragon */}
            {(myBets['dragon'] || 0) > 0 && (
              <div className="mt-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white font-mono font-extrabold text-[10px] shadow animate-bounce">
                ₹{myBets['dragon']}
              </div>
            )}
          </button>

          {/* TIE SPOT */}
          <button
            onClick={() => handlePlaceBet('tie')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`col-span-1 rounded-xl p-2 border flex flex-col items-center justify-between transition-all duration-200 active:scale-95 relative overflow-hidden ${
              (myBets['tie'] || 0) > 0
                ? 'bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg'
                : 'bg-zinc-900/90 hover:bg-zinc-800/90 border-emerald-900/40 hover:border-emerald-500/60'
            } ${dragonTigerRound.status !== 'BETTING' ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <span className="text-xs font-black text-emerald-400 font-serif">TIE</span>
            <span className="text-[9px] text-emerald-300 font-mono font-bold">8 : 1</span>

            {/* My Placed Chips on Tie */}
            {(myBets['tie'] || 0) > 0 && (
              <div className="mt-1 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-mono font-extrabold text-[10px] shadow animate-bounce">
                ₹{myBets['tie']}
              </div>
            )}
          </button>

          {/* SUITED TIE SPOT */}
          <button
            onClick={() => handlePlaceBet('suited_tie')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`col-span-1 rounded-xl p-2 border flex flex-col items-center justify-between transition-all duration-200 active:scale-95 relative overflow-hidden ${
              (myBets['suited_tie'] || 0) > 0
                ? 'bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/50 shadow-lg'
                : 'bg-zinc-900/90 hover:bg-zinc-800/90 border-purple-900/40 hover:border-purple-500/60'
            } ${dragonTigerRound.status !== 'BETTING' ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <span className="text-[11px] font-black text-purple-300 font-serif text-center leading-tight">
              SUITED TIE
            </span>
            <span className="text-[9px] text-amber-300 font-mono font-bold">50 : 1</span>

            {/* My Placed Chips on Suited Tie */}
            {(myBets['suited_tie'] || 0) > 0 && (
              <div className="mt-1 px-1.5 py-0.5 rounded-full bg-purple-600 text-white font-mono font-extrabold text-[10px] shadow animate-bounce">
                ₹{myBets['suited_tie']}
              </div>
            )}
          </button>

          {/* TIGER SPOT */}
          <button
            onClick={() => handlePlaceBet('tiger')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`col-span-1 rounded-xl p-2 border flex flex-col items-center justify-between transition-all duration-200 active:scale-95 relative overflow-hidden ${
              (myBets['tiger'] || 0) > 0
                ? 'bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
                : 'bg-zinc-900/90 hover:bg-zinc-800/90 border-amber-900/40 hover:border-amber-500/60'
            } ${dragonTigerRound.status !== 'BETTING' ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-black text-amber-400 font-serif">TIGER</span>
            </div>
            <span className="text-[9px] text-zinc-400 font-mono">1 : 1</span>

            {/* My Placed Chips on Tiger */}
            {(myBets['tiger'] || 0) > 0 && (
              <div className="mt-1 px-1.5 py-0.5 rounded-full bg-amber-600 text-black font-mono font-extrabold text-[10px] shadow animate-bounce">
                ₹{myBets['tiger']}
              </div>
            )}
          </button>
        </div>

        {/* Secondary Side Bets: Big/Small (1:1) */}
        <div className="grid grid-cols-4 gap-1 text-[10px]">
          <button
            onClick={() => handlePlaceBet('dragon_big')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`p-1.5 rounded-lg border flex items-center justify-between transition ${
              (myBets['dragon_big'] || 0) > 0
                ? 'bg-red-950 border-red-500 text-red-300 font-bold'
                : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
            }`}
          >
            <span>D Big (8-K)</span>
            <span className="font-mono text-zinc-500">1:1</span>
          </button>
          <button
            onClick={() => handlePlaceBet('dragon_small')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`p-1.5 rounded-lg border flex items-center justify-between transition ${
              (myBets['dragon_small'] || 0) > 0
                ? 'bg-red-950 border-red-500 text-red-300 font-bold'
                : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
            }`}
          >
            <span>D Small (A-6)</span>
            <span className="font-mono text-zinc-500">1:1</span>
          </button>
          <button
            onClick={() => handlePlaceBet('tiger_big')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`p-1.5 rounded-lg border flex items-center justify-between transition ${
              (myBets['tiger_big'] || 0) > 0
                ? 'bg-amber-950 border-amber-500 text-amber-300 font-bold'
                : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
            }`}
          >
            <span>T Big (8-K)</span>
            <span className="font-mono text-zinc-500">1:1</span>
          </button>
          <button
            onClick={() => handlePlaceBet('tiger_small')}
            disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet}
            className={`p-1.5 rounded-lg border flex items-center justify-between transition ${
              (myBets['tiger_small'] || 0) > 0
                ? 'bg-amber-950 border-amber-500 text-amber-300 font-bold'
                : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
            }`}
          >
            <span>T Small (A-6)</span>
            <span className="font-mono text-zinc-500">1:1</span>
          </button>
        </div>
      </div>

      {/* 6. CHIP SELECTOR & ACTIONS TRAY */}
      <div className="relative z-10 px-3 py-1.5 space-y-1.5 bg-zinc-950/95 border-t border-zinc-800/80 backdrop-blur-md">
        {/* Chip Denominations */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1 scrollbar-none">
          {CHIP_DENOMINATIONS.map((chip) => {
            const isSelected = selectedChip === chip;
            return (
              <button
                key={chip}
                onClick={() => {
                  setSelectedChip(chip);
                  dragonTigerAudio.playChipSound();
                }}
                className={`flex-1 min-w-[48px] py-1.5 rounded-xl border flex flex-col items-center justify-center transition-all duration-200 active:scale-90 ${
                  isSelected
                    ? 'bg-gradient-to-t from-amber-600 via-amber-500 to-amber-400 text-zinc-950 font-black border-amber-300 shadow-md shadow-amber-500/30 scale-105'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <div className="w-5 h-5 rounded-full border border-dashed border-current flex items-center justify-center mb-0.5">
                  <span className="text-[8px] font-mono font-bold">₹</span>
                </div>
                <span className="text-[11px] font-mono font-bold leading-none">
                  {chip >= 1000 ? `${chip / 1000}k` : chip}
                </span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons: Clear, Double, Rebet */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setMyBets({});
                dragonTigerAudio.playChipSound();
              }}
              disabled={dragonTigerRound.status !== 'BETTING' || totalMyBetAmount === 0}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition active:scale-95 text-[11px] font-semibold"
            >
              Clear
            </button>
            <button
              onClick={handleDoubleBets}
              disabled={dragonTigerRound.status !== 'BETTING' || totalMyBetAmount === 0 || isSubmittingBet}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-amber-400 hover:text-amber-300 hover:bg-zinc-800 disabled:opacity-40 transition active:scale-95 text-[11px] font-semibold"
            >
              2x Double
            </button>
            <button
              onClick={handleRebet}
              disabled={dragonTigerRound.status !== 'BETTING' || isSubmittingBet || Object.keys(lastRoundBets).length === 0}
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
                {dragonTigerLiveBets.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-8">
                    Waiting for round bets to roll in...
                  </p>
                ) : (
                  dragonTigerLiveBets.map((bet) => (
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
                          <span
                            className={`text-[9px] font-bold uppercase ${
                              bet.type === 'dragon'
                                ? 'text-red-400'
                                : bet.type === 'tiger'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {bet.type.replace('_', ' ')}
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
              Synchronized Community Engine v2.4
            </div>
          </div>
        </div>
      )}

      {/* 8. RULES & PAYOUTS MODAL (TELUGU / ENGLISH DETAILED RULES) */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 animate-fadeIn">
          <div className="w-full max-w-lg bg-zinc-950 border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center font-black">
                  DT
                </div>
                <div>
                  <h3 className="font-serif font-black text-base text-amber-300">
                    Dragon Tiger - Rules & Payouts
                  </h3>
                  <p className="text-[10px] text-zinc-400">ఆట నియమాలు & పేఔట్స్ గైడ్</p>
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
              {(['rules', 'payouts', 'rankings', 'faq'] as const).map((tab) => (
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
                  {tab === 'rankings' && 'Card Ranks'}
                  {tab === 'faq' && 'FAQ'}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto py-3 text-xs text-zinc-300 space-y-3 pr-1">
              {activeRulesTab === 'rules' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1 flex items-center gap-1.5">
                      <span>1. గేమ్ ఉద్దేశం (Objective)</span>
                    </h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      Dragon Tiger అనేది ఆసియాలో అత్యంత ప్రజాదరణ పొందిన 2-కార్డ్ క్యాసినో గేమ్. డీలర్ <strong>డ్రాగన్ (Dragon)</strong> మరియు <strong>టైగర్ (Tiger)</strong> వైపులకి ఒక్కొక్క కార్డును ఫేస్-అప్ డీల్ చేస్తారు. ఏ కార్డు విలువ ఎక్కువైతే ఆ పక్షం గెలుస్తుంది!
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1">2. ఆన్‌లైన్ సింక్రొనైజ్డ్ రౌండ్ (Shared Round)</h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      ఎంతమంది ఆటగాళ్లు వచ్చినా ఒకే లైవ్ సర్వర్ రౌండ్‌కి కనెక్ట్ అవుతారు. ప్రతి రౌండ్‌లో 12 సెకన్ల పాటు బెట్ వేసుకోవచ్చు. టైమర్ ముగిసిన వెంటనే డీలర్ రెండు కార్డులను రివీల్ చేస్తారు.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-1">3. కార్డ్ విలువలు (Card Values)</h4>
                    <p className="leading-relaxed text-zinc-300 text-[11px]">
                      ఈ గేమ్‌లో <strong>Ace అనేది కనిష్ట కార్డు (1 పాయింట్)</strong> మరియు <strong>King అనేది గరిష్ట కార్డు (13 పాయింట్లు)</strong>. సూట్‌తో సంబంధం లేకుండా కేవలం కార్డ్ ర్యాంక్ ఆధారంగా మాత్రమే గెలుపోటములు నిర్ణయిస్తారు.
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'payouts' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 font-bold text-zinc-400 text-[11px]">
                    <span>Bet Type</span>
                    <span>Payout</span>
                    <span>Odds / Description</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-red-950/40 border border-red-900/40 text-[11px] items-center">
                    <span className="font-bold text-red-400">DRAGON</span>
                    <span className="font-mono font-bold text-white">1 : 1</span>
                    <span className="text-zinc-400">డ్రాగన్ కార్డు ఎక్కువైతే గెలుపు</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-900/40 text-[11px] items-center">
                    <span className="font-bold text-amber-400">TIGER</span>
                    <span className="font-mono font-bold text-white">1 : 1</span>
                    <span className="text-zinc-400">టైగర్ కార్డు ఎక్కువైతే గెలుపు</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-900/40 text-[11px] items-center">
                    <span className="font-bold text-emerald-400">TIE</span>
                    <span className="font-mono font-bold text-emerald-300">8 : 1</span>
                    <span className="text-zinc-400">రెండు కార్డుల ర్యాంక్ సమానమైతే (8x లాభం)</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-purple-950/40 border border-purple-900/40 text-[11px] items-center">
                    <span className="font-bold text-purple-300">SUITED TIE</span>
                    <span className="font-mono font-bold text-amber-300">50 : 1</span>
                    <span className="text-zinc-400">ఒకే ర్యాంక్ మరియు ఒకే సూట్ (జాక్‌పాట్!)</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] items-center">
                    <span className="font-bold text-zinc-300">Big (8 to K)</span>
                    <span className="font-mono font-bold text-white">1 : 1</span>
                    <span className="text-zinc-400">కార్డు 8 నుండి K మధ్య ఉంటే గెలుపు</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] items-center">
                    <span className="font-bold text-zinc-300">Small (A to 6)</span>
                    <span className="font-mono font-bold text-white">1 : 1</span>
                    <span className="text-zinc-400">కార్డు A నుండి 6 మధ్య ఉంటే గెలుపు</span>
                  </div>
                </div>
              )}

              {activeRulesTab === 'rankings' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h4 className="font-bold text-amber-400 mb-2">Card Hierarchy (తక్కువ నుండి ఎక్కువ వరకు):</h4>
                    <div className="flex flex-wrap gap-1.5 items-center font-mono font-bold text-xs">
                      {['A (1)', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J (11)', 'Q (12)', 'K (13)'].map((card, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200"
                        >
                          {card}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] space-y-1.5">
                    <h4 className="font-bold text-amber-400">ఉదాహరణలు:</h4>
                    <p className="text-zinc-300">
                      • డ్రాగన్ కింగ్ (K) & టైగర్ క్వీన్ (Q) వస్తే: <strong>డ్రాగన్ గెలుస్తుంది!</strong>
                    </p>
                    <p className="text-zinc-300">
                      • డ్రాగన్ ఏస్ (A) & టైగర్ 2 వస్తే: <strong>టైగర్ గెలుస్తుంది (A = 1)!</strong>
                    </p>
                    <p className="text-zinc-300">
                      • డ్రాగన్ 9♠ & టైగర్ 9♥ వస్తే: <strong>టై (TIE) అవుతుంది!</strong>
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'faq' && (
                <div className="space-y-2.5 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h5 className="font-bold text-amber-400 mb-0.5">Tie వస్తే Dragon/Tiger బెట్స్ ఏమవుతాయి?</h5>
                    <p className="text-zinc-300">
                      Tie వచ్చినప్పుడు డ్రాగన్ లేదా టైగర్‌పై పెట్టిన బెట్‌లో 50% వాపస్ వస్తుంది లేదా హౌస్ రూల్ ప్రకారం టై బెట్ మాత్రమే 8:1 పేమెంట్ పొందుతుంది.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h5 className="font-bold text-amber-400 mb-0.5">7 నంబర్ కార్డ్ వస్తే Big/Small ఏమవుతుంది?</h5>
                    <p className="text-zinc-300">
                      సాంప్రదాయ క్యాసినో నిబంధనల ప్రకారం కార్డ్ 7 వచ్చినప్పుడు Big మరియు Small రెండూ లాస్ అవుతాయి (హౌస్ ఎడ్జ్).
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <h5 className="font-bold text-amber-400 mb-0.5">విన్నింగ్ అమౌంట్ ఎప్పుడు జమ అవుతుంది?</h5>
                    <p className="text-zinc-300">
                      ప్రతి రౌండ్ ముగిసిన తక్షణం డబుల్ ఎంట్రీ లెడ్జర్ ద్వారా మీ వ్యాలెట్ బ్యాలెన్స్‌కి అమౌంట్ నేరుగా క్రెడిట్ అవుతుంది.
                    </p>
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
    </div>
  );
};
