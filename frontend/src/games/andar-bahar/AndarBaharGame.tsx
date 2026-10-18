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
  Timer,
  Layers,
  CheckCircle2,
  Users,
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
import { andarBaharAudio } from './AndarBaharAudio';

const CHIP_DENOMINATIONS = [10, 50, 100, 500, 1000, 5000];

export const AndarBaharGame: React.FC<{ onBackToLobby: () => void }> = ({ onBackToLobby }) => {
  const { user, refreshWallet } = useAuth();
  const {
    isConnected,
    andarBaharRound,
    andarBaharHistory,
    andarBaharLiveBets,
  } = useWebSocket();

  // Audio & Modals
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [activeRulesTab, setActiveRulesTab] = useState<'rules' | 'payouts' | 'faq'>('rules');

  // Betting State
  const [selectedChip, setSelectedChip] = useState<number>(50);
  const [myBets, setMyBets] = useState<Record<string, number>>({});
  const [isSubmittingBet, setIsSubmittingBet] = useState<boolean>(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live Timer Countdown Seconds
  const [timeLeftSec, setTimeLeftSec] = useState<number>(13);
  const lastRoundIdRef = useRef<string | null>(null);

  // Sound sync
  useEffect(() => {
    andarBaharAudio.enabled = soundEnabled;
  }, [soundEnabled]);

  // Synchronized Countdown Timer (calculated from server bettingEndsAt)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (andarBaharRound.status === 'BETTING') {
        const diff = Math.max(0, Math.ceil((andarBaharRound.bettingEndsAt - now) / 1000));
        setTimeLeftSec(diff);
      } else {
        setTimeLeftSec(0);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [andarBaharRound.status, andarBaharRound.bettingEndsAt]);

  // Round transition handling
  useEffect(() => {
    if (andarBaharRound.id !== lastRoundIdRef.current) {
      lastRoundIdRef.current = andarBaharRound.id;
      if (andarBaharRound.status === 'BETTING') {
        setMyBets({});
      }
    }

    // Play deal sound on incoming card
    if (andarBaharRound.status === 'DEALING' && andarBaharRound.dealCards.length > 0) {
      andarBaharAudio.playDealSound();
    }

    // Play fanfare if result settled and user won
    if (andarBaharRound.status === 'RESULT' && andarBaharRound.winningSide) {
      andarBaharAudio.playMatchSound();
      const myWonBet = myBets[andarBaharRound.winningSide];
      if (myWonBet && myWonBet > 0) {
        andarBaharAudio.playWinFanfare();
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#f59e0b', '#3b82f6', '#ffffff'],
        });
        refreshWallet();
      }
    }
  }, [andarBaharRound.id, andarBaharRound.status, andarBaharRound.dealCards.length, andarBaharRound.winningSide]);

  const showNotification = (msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => setNoticeMessage(null), 3000);
  };

  // Place bet on Andar or Bahar or Side Bet
  const handlePlaceBet = async (side: string) => {
    if (andarBaharRound.status !== 'BETTING') {
      setErrorMessage('Betting is closed for this round. Please wait for next round.');
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }

    andarBaharAudio.playChipSound();
    setIsSubmittingBet(true);
    setErrorMessage(null);

    const betAmountStr = selectedChip.toString();

    try {
      await ApiClient.placeAndarBaharBet({
        bets: [{ type: side, amount: betAmountStr }],
      });

      setMyBets((prev) => ({
        ...prev,
        [side]: (prev[side] || 0) + selectedChip,
      }));

      showNotification(`₹${selectedChip} placed on ${side.toUpperCase()}!`);
      refreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error placing bet');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  // Group dealt cards by side (Andar vs Bahar)
  const andarCards = andarBaharRound.dealCards.filter((c) => c.side === 'andar');
  const baharCards = andarBaharRound.dealCards.filter((c) => c.side === 'bahar');

  const joker = andarBaharRound.jokerCard;
  const isJokerBlack = joker ? SUIT_COLORS[joker.suit] === 'black' : false;

  return (
    <div className="w-full px-2 py-1.5 space-y-2 text-zinc-100 pb-16 select-none font-sans">
      {/* 1. TOP HEADER BAR: Lobby, Round #, Live Indicator, Rules & Sound */}
      <div className="flex items-center justify-between gap-1.5 bg-zinc-900/90 border border-zinc-800/80 rounded-xl px-2.5 py-1.5 shadow-sm">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onBackToLobby}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition active:scale-95"
            title="Return to Casino Lobby"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Lobby</span>
          </button>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-bold">
            <Crown className="w-3 h-3 text-amber-400" />
            <span>#{andarBaharRound.roundNumber}</span>
          </div>
        </div>

        {/* Synchronized Multiplayer Live Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>SYNCED LIVE</span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowRulesModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-zinc-300 hover:text-amber-300 transition rounded-lg hover:bg-zinc-800 text-[11px] font-semibold bg-zinc-800/60 border border-zinc-700/60"
            title="Official Andar Bahar Rules & Payouts"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Rules</span>
          </button>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 text-zinc-400 hover:text-amber-300 transition rounded-lg hover:bg-zinc-800"
            title={soundEnabled ? 'Mute Audio' : 'Unmute Audio'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
          </button>
        </div>
      </div>

      {/* 2. RECENT ROUNDS WINNING HISTORY ROADMAP */}
      <div className="flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-800/80 rounded-xl px-2.5 py-1 text-[11px] overflow-x-auto scrollbar-none">
        <span className="text-[9px] font-mono font-bold text-amber-400/90 uppercase tracking-wider shrink-0">
          History:
        </span>
        <div className="flex items-center gap-1">
          {andarBaharHistory.slice(0, 10).map((h, idx) => {
            const isAndar = h.winningSide === 'andar';
            return (
              <div
                key={idx}
                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border shadow-sm ${
                  isAndar
                    ? 'bg-blue-950/80 border-blue-500/60 text-blue-300'
                    : 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                }`}
                title={`Round #${h.roundNumber}: ${h.winningSide.toUpperCase()} won on card #${h.totalCards}`}
              >
                <span>{isAndar ? 'A' : 'B'}</span>
                <span className="text-[9px] text-zinc-400">({h.totalCards})</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. COMPACT REAL-TIME COUNTDOWN & STATUS BANNER */}
      <div className="flex items-center justify-between bg-zinc-900/90 border border-zinc-800/80 rounded-xl px-2.5 py-1.5 shadow-sm">
        <div className="flex items-center gap-2">
          {andarBaharRound.status === 'BETTING' && (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Place Your Bets</span>
            </div>
          )}
          {andarBaharRound.status === 'DEALING' && (
            <div className="flex items-center gap-1.5 text-amber-300">
              <Layers className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Dealing Cards ({andarBaharRound.totalCardsDealt} Dealt)
              </span>
            </div>
          )}
          {andarBaharRound.status === 'RESULT' && (
            <div className="flex items-center gap-1.5 text-yellow-300">
              <Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                {andarBaharRound.winningSide?.toUpperCase()} WON! (Card #{andarBaharRound.totalCardsDealt})
              </span>
            </div>
          )}
        </div>

        {/* Countdown Timer */}
        <div className="flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-zinc-400" />
          {andarBaharRound.status === 'BETTING' && (
            <span className="font-mono text-xs font-black text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-600/40">
              {timeLeftSec}s
            </span>
          )}
          {andarBaharRound.status === 'DEALING' && (
            <span className="font-mono text-xs font-black text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-600/40">
              Live Deal
            </span>
          )}
          {andarBaharRound.status === 'RESULT' && (
            <span className="font-mono text-[10px] font-bold text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/50">
              Next round soon...
            </span>
          )}
        </div>
      </div>

      {/* Notifications */}
      {noticeMessage && (
        <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-semibold flex items-center gap-2 animate-fadeIn shadow-sm">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{noticeMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="p-2 rounded-xl bg-red-950/80 border border-red-800/60 text-red-200 text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 4. AUTHENTIC CASINO ANDAR BAHAR FELT TABLE */}
      <div className="relative w-full rounded-2xl bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 border-4 border-amber-900/60 shadow-[inset_0_0_50px_rgba(0,0,0,0.8)] p-3 overflow-hidden flex flex-col justify-between min-h-[390px]">
        {/* Felt Watermark */}
        <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
          <span className="text-5xl font-black font-serif text-amber-300 tracking-widest text-center">
            ANDAR BAHAR
          </span>
        </div>

        {/* Gold Border Trim */}
        <div className="absolute inset-2 border border-emerald-500/20 rounded-xl pointer-events-none" />

        {/* =========================================================================
            TOP SECTION: JOKER CARD SHOWCASE (MATCHING TARGET)
            ========================================================================= */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1">
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            <span>Joker (Trump Card)</span>
          </div>

          {joker ? (
            <div className="relative">
              {/* Gold Ring Frame */}
              <div className="w-16 h-22 rounded-xl bg-gradient-to-br from-white to-zinc-100 border-2 border-yellow-400 shadow-2xl flex flex-col justify-between p-1.5 select-none transform transition-transform hover:scale-105">
                <div className="flex items-center justify-between leading-none">
                  <span className={`text-sm font-black ${SUIT_COLORS[joker.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                    {getRankLabel(joker.rank)}
                  </span>
                  <span className={`text-sm ${SUIT_COLORS[joker.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                    {SUIT_SYMBOLS[joker.suit]}
                  </span>
                </div>
                <div className="flex items-center justify-center my-auto">
                  <span className={`text-3xl ${SUIT_COLORS[joker.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                    {SUIT_SYMBOLS[joker.suit]}
                  </span>
                </div>
                <div className="flex items-center justify-end leading-none">
                  <span className={`text-sm font-black ${SUIT_COLORS[joker.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                    {getRankLabel(joker.rank)}
                  </span>
                </div>
              </div>
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-950 text-amber-300 border border-amber-500/60 shadow whitespace-nowrap">
                Match Rank {getRankLabel(joker.rank)}
              </span>
            </div>
          ) : (
            <div className="w-16 h-22 rounded-xl bg-zinc-900 border-2 border-dashed border-amber-500/40 flex items-center justify-center text-zinc-500">
              Dealing...
            </div>
          )}

          <div className="mt-2.5 text-[9px] text-zinc-400 font-medium">
            First Card Deals to:{' '}
            <strong className={isJokerBlack ? 'text-blue-400' : 'text-amber-400'}>
              {isJokerBlack ? 'ANDAR (Black Joker)' : 'BAHAR (Red Joker)'}
            </strong>
          </div>
        </div>

        {/* =========================================================================
            MIDDLE SECTION: ANDAR VS BAHAR DEALT CARDS TRACK
            ========================================================================= */}
        <div className="relative z-10 grid grid-cols-2 gap-2 my-2">
          {/* ANDAR TRACK (LEFT) */}
          <div className={`p-2 rounded-xl border transition-all ${
            andarBaharRound.winningSide === 'andar'
              ? 'bg-blue-950/80 border-yellow-400 ring-2 ring-yellow-400 shadow-xl'
              : 'bg-zinc-950/60 border-blue-500/40'
          }`}>
            <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-zinc-800">
              <span className="font-bold text-xs uppercase tracking-wider text-blue-400 flex items-center gap-1">
                <span>Andar (అందర్)</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                {andarCards.length} Cards
              </span>
            </div>

            {/* Andar Cards Horizontal Row */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-h-[52px] p-0.5">
              {andarCards.length === 0 ? (
                <span className="text-[10px] text-zinc-600 italic">No cards yet</span>
              ) : (
                andarCards.map((item, idx) => {
                  const isMatch = joker && item.card.rank === joker.rank;
                  return (
                    <div
                      key={idx}
                      className={`w-9 h-13 rounded-lg border flex flex-col justify-between p-1 shrink-0 select-none shadow-md transition-all ${
                        isMatch
                          ? 'bg-yellow-300 text-black border-yellow-400 ring-2 ring-yellow-400 scale-105 animate-bounce font-black'
                          : 'bg-white text-zinc-900 border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[9px] leading-none font-bold">
                        <span className={SUIT_COLORS[item.card.suit] === 'red' ? 'text-red-600' : 'text-zinc-950'}>
                          {getRankLabel(item.card.rank)}
                        </span>
                        <span className={SUIT_COLORS[item.card.suit] === 'red' ? 'text-red-600' : 'text-zinc-950'}>
                          {SUIT_SYMBOLS[item.card.suit]}
                        </span>
                      </div>
                      <div className="text-center text-sm leading-none">
                        <span className={SUIT_COLORS[item.card.suit] === 'red' ? 'text-red-600' : 'text-zinc-950'}>
                          {SUIT_SYMBOLS[item.card.suit]}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* BAHAR TRACK (RIGHT) */}
          <div className={`p-2 rounded-xl border transition-all ${
            andarBaharRound.winningSide === 'bahar'
              ? 'bg-amber-950/80 border-yellow-400 ring-2 ring-yellow-400 shadow-xl'
              : 'bg-zinc-950/60 border-amber-500/40'
          }`}>
            <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-zinc-800">
              <span className="font-bold text-xs uppercase tracking-wider text-amber-400 flex items-center gap-1">
                <span>Bahar (బహార్)</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                {baharCards.length} Cards
              </span>
            </div>

            {/* Bahar Cards Horizontal Row */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-h-[52px] p-0.5">
              {baharCards.length === 0 ? (
                <span className="text-[10px] text-zinc-600 italic">No cards yet</span>
              ) : (
                baharCards.map((item, idx) => {
                  const isMatch = joker && item.card.rank === joker.rank;
                  return (
                    <div
                      key={idx}
                      className={`w-9 h-13 rounded-lg border flex flex-col justify-between p-1 shrink-0 select-none shadow-md transition-all ${
                        isMatch
                          ? 'bg-yellow-300 text-black border-yellow-400 ring-2 ring-yellow-400 scale-105 animate-bounce font-black'
                          : 'bg-white text-zinc-900 border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[9px] leading-none font-bold">
                        <span className={SUIT_COLORS[item.card.suit] === 'red' ? 'text-red-600' : 'text-zinc-950'}>
                          {getRankLabel(item.card.rank)}
                        </span>
                        <span className={SUIT_COLORS[item.card.suit] === 'red' ? 'text-red-600' : 'text-zinc-950'}>
                          {SUIT_SYMBOLS[item.card.suit]}
                        </span>
                      </div>
                      <div className="text-center text-sm leading-none">
                        <span className={SUIT_COLORS[item.card.suit] === 'red' ? 'text-red-600' : 'text-zinc-950'}>
                          {SUIT_SYMBOLS[item.card.suit]}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* =========================================================================
            BOTTOM SECTION: ANDAR VS BAHAR PRIMARY BETTING BUTTONS
            ========================================================================= */}
        <div className="relative z-10 grid grid-cols-2 gap-2 mt-1">
          {/* ANDAR BET BUTTON */}
          <button
            onClick={() => handlePlaceBet('andar')}
            disabled={andarBaharRound.status !== 'BETTING' || isSubmittingBet}
            className={`p-3 rounded-xl border transition-all flex flex-col items-center justify-center active:scale-95 disabled:opacity-50 ${
              myBets['andar']
                ? 'bg-blue-600 border-yellow-400 ring-2 ring-yellow-400 text-white shadow-lg'
                : 'bg-gradient-to-br from-blue-900/90 to-blue-950 hover:from-blue-800 hover:to-blue-900 border-blue-500/60 text-blue-100 shadow-md'
            }`}
          >
            <span className="text-xs font-black uppercase tracking-wider">
              ANDAR (అందర్)
            </span>
            <span className="text-[10px] font-mono text-blue-300 mt-0.5">
              Odds: {andarBaharRound.firstSide === 'andar' ? '1.9x' : '2.0x'}
            </span>
            {myBets['andar'] && (
              <span className="mt-1 px-2 py-0.5 rounded-full bg-yellow-400 text-zinc-950 text-[10px] font-black font-mono shadow">
                Your Bet: ₹{myBets['andar']}
              </span>
            )}
            <span className="text-[9px] text-zinc-400 mt-0.5">
              Total: ₹{parseInt(andarBaharRound.andarBetAmount || '0', 10).toLocaleString()}
            </span>
          </button>

          {/* BAHAR BET BUTTON */}
          <button
            onClick={() => handlePlaceBet('bahar')}
            disabled={andarBaharRound.status !== 'BETTING' || isSubmittingBet}
            className={`p-3 rounded-xl border transition-all flex flex-col items-center justify-center active:scale-95 disabled:opacity-50 ${
              myBets['bahar']
                ? 'bg-amber-600 border-yellow-400 ring-2 ring-yellow-400 text-white shadow-lg'
                : 'bg-gradient-to-br from-amber-900/90 to-amber-950 hover:from-amber-800 hover:to-amber-900 border-amber-500/60 text-amber-100 shadow-md'
            }`}
          >
            <span className="text-xs font-black uppercase tracking-wider">
              BAHAR (బహార్)
            </span>
            <span className="text-[10px] font-mono text-amber-300 mt-0.5">
              Odds: {andarBaharRound.firstSide === 'bahar' ? '1.9x' : '2.0x'}
            </span>
            {myBets['bahar'] && (
              <span className="mt-1 px-2 py-0.5 rounded-full bg-yellow-400 text-zinc-950 text-[10px] font-black font-mono shadow">
                Your Bet: ₹{myBets['bahar']}
              </span>
            )}
            <span className="text-[9px] text-zinc-400 mt-0.5">
              Total: ₹{parseInt(andarBaharRound.baharBetAmount || '0', 10).toLocaleString()}
            </span>
          </button>
        </div>

        {/* Live Community Table Wager Summary */}
        <div className="relative z-10 mt-1.5 flex items-center justify-between text-[10px] text-zinc-400 px-1">
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3 text-amber-400" />
            <span>Table Pot: <strong className="text-zinc-200 font-mono">₹{parseInt(andarBaharRound.totalBetAmount || '0', 10).toLocaleString()}</strong></span>
          </div>
          <span className="font-mono text-zinc-400">{andarBaharRound.totalBetsCount} Bet(s) Placed</span>
        </div>
      </div>

      {/* 5. CHIP DENOMINATION SELECTOR BAR */}
      <div className="flex items-center justify-between bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-1.5">
        <span className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider pl-1">
          Chips:
        </span>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          {CHIP_DENOMINATIONS.map((val) => (
            <button
              key={val}
              onClick={() => {
                setSelectedChip(val);
                andarBaharAudio.playChipSound();
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition active:scale-95 flex items-center gap-0.5 ${
                selectedChip === val
                  ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20 ring-2 ring-yellow-400'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <span>₹{val >= 1000 ? `${val / 1000}k` : val}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 6. SIDE BETS: JOKER COLOR & TOTAL CARDS RANGE */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-2.5 space-y-2 shadow-xl">
        <span className="text-[10px] font-black uppercase text-amber-300 tracking-wider block">
          Side Bets (మరిన్ని బెట్స్):
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handlePlaceBet('joker_red')}
            disabled={andarBaharRound.status !== 'BETTING'}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-left transition disabled:opacity-50"
          >
            <span className="text-[11px] font-bold text-red-400 block">Joker Red (♥/♦)</span>
            <span className="text-[10px] font-mono text-zinc-400">1.95x Payout</span>
          </button>
          <button
            onClick={() => handlePlaceBet('joker_black')}
            disabled={andarBaharRound.status !== 'BETTING'}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-left transition disabled:opacity-50"
          >
            <span className="text-[11px] font-bold text-zinc-200 block">Joker Black (♠/♣)</span>
            <span className="text-[10px] font-mono text-zinc-400">1.95x Payout</span>
          </button>
        </div>
      </div>

      {/* 7. OFFICIAL ANDAR BAHAR RULES & PAYOUTS MODAL */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md max-h-[88vh] bg-zinc-950 border border-amber-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-zinc-800 bg-zinc-900/60">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-amber-200 uppercase tracking-wider font-serif">
                  Andar Bahar Official Rules & Odds
                </h3>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 p-2 bg-zinc-900 border-b border-zinc-800">
              <button
                onClick={() => setActiveRulesTab('rules')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeRulesTab === 'rules'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                How to Play
              </button>
              <button
                onClick={() => setActiveRulesTab('payouts')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeRulesTab === 'payouts'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Payout Odds
              </button>
              <button
                onClick={() => setActiveRulesTab('faq')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeRulesTab === 'faq'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Sync Rounds
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs leading-relaxed text-zinc-300">
              {activeRulesTab === 'rules' && (
                <div className="space-y-3">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">1. Game Objective (లక్ష్యం)</h4>
                    <p className="text-zinc-400 text-[11px]">
                      డీలర్ ముందుగా మధ్యలో ఒక <strong>Joker (ట్రంప్ కార్డ్)</strong> తీస్తారు. ఆ తర్వాత కార్డులను మార్చి మార్చి అందర్ (Andar) మరియు బహార్ (Bahar) లలో వేస్తారు. జోకర్ కార్డ్ ర్యాంక్ (ఉదాహరణకు 8 లేదా K) ఏ వైపు ముందుగా వస్తుందో ఊహించి బెట్ వేయడమే ఈ గేమ్ లక్ష్యం.
                    </p>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">2. First Card Rule (మొదటి కార్డ్ రూల్)</h4>
                    <p className="text-zinc-400 text-[11px]">
                      • జోకర్ కార్డ్ <strong>బ్లాక్ (నలుపు - ♠ లేదా ♣)</strong> అయితే మొదటి కార్డ్ <strong>ANDAR</strong> కి వెళ్తుంది.<br />
                      • జోకర్ కార్డ్ <strong>రెడ్ (ఎరుపు - ♥ లేదా ♦)</strong> అయితే మొదటి కార్డ్ <strong>BAHAR</strong> కి వెళ్తుంది.
                    </p>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">3. Match Found & Settlement</h4>
                    <p className="text-zinc-400 text-[11px]">
                      ఏ వైపు అయితే జోకర్ ర్యాంక్‌తో సరిపోలే కార్డ్ పడుతుందో ఆ వైపు గెలిచినట్లు ప్రకటిస్తారు. వెంటనే గెలిచిన బెట్స్‌కు పేఅవుట్ నేరుగా మీ వాలెట్‌కు చేరుతుంది.
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'payouts' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-zinc-400">
                    అఫీషియల్ కేసినో పేఅవుట్ మల్టిప్లైయర్స్:
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">First Dealt Side</span>
                      <span className="text-emerald-400 font-mono font-black text-sm">1.90x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Second Dealt Side</span>
                      <span className="text-amber-400 font-mono font-black text-sm">2.00x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Joker Red / Black</span>
                      <span className="text-cyan-400 font-mono font-black text-sm">1.95x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Cards 25+ Range</span>
                      <span className="text-purple-400 font-mono font-black text-sm">25.0x Payout</span>
                    </div>
                  </div>
                </div>
              )}

              {activeRulesTab === 'faq' && (
                <div className="space-y-3">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">Synchronized Multiplayer Table</h4>
                    <p className="text-zinc-400 text-[11px]">
                      ఎంతమంది ప్లేయర్లు లాగిన్ అయినా అందరూ **ఒకే లైవ్ రౌండ్‌కు** కనెక్ట్ అవుతారు. ఒకే జోకర్ కార్డ్, ఒకే టైమర్ మరియు రియల్-టైమ్ డీలింగ్ యానిమేషన్ అందరి స్క్రీన్‌లలో ఏకకాలంలో కనిపిస్తుంది.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-zinc-800 bg-zinc-900/60 flex justify-end">
              <button
                onClick={() => setShowRulesModal(false)}
                className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs uppercase transition active:scale-95 shadow"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
