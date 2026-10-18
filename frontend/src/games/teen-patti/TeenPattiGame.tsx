import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Sparkles,
  HelpCircle,
  Eye,
  RotateCcw,
  Trophy,
  Coins,
  Crown,
  X,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiClient } from '../../api/client';
import {
  Card,
  SUIT_SYMBOLS,
  SUIT_COLORS,
  getRankLabel,
  evaluateTeenPattiHand,
  createDeck,
  shuffleDeck,
  compareHands,
} from '../../../../shared/src/utils/teenPatti';
import { teenPattiAudio } from './TeenPattiAudio';

interface PlayerState {
  id: string;
  name: string;
  isAi: boolean;
  isSeen: boolean;
  hasFolded: boolean;
  totalBet: number;
  cards: Card[] | null;
  avatar: string;
}

const CHIP_DENOMINATIONS = [50, 100, 500, 1000, 5000];

export const TeenPattiGame: React.FC<{ onBackToLobby: () => void }> = ({ onBackToLobby }) => {
  const { user, refreshWallet } = useAuth();

  // Audio & Modals
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [activeRulesTab, setActiveRulesTab] = useState<'ranks' | 'rules' | 'payouts'>('ranks');

  // Table State: Heads-up (Player vs Dealer only)
  const [roundNumber, setRoundNumber] = useState<number>(101);
  const [bootAmount, setBootAmount] = useState<number>(50);
  const [selectedChip, setSelectedChip] = useState<number>(50);
  const [currentStake, setCurrentStake] = useState<number>(50);
  const [tablePot, setTablePot] = useState<number>(100);
  const [gameState, setGameState] = useState<'IDLE' | 'DEALING' | 'BETTING' | 'SHOWDOWN' | 'SETTLED'>('IDLE');

  // Player and Dealer
  const [player, setPlayer] = useState<PlayerState>({
    id: user?.id || 'player-self',
    name: user?.username || 'Player',
    isAi: false,
    isSeen: false,
    hasFolded: false,
    totalBet: 50,
    cards: null,
    avatar: '🧑',
  });

  const [dealer, setDealer] = useState<PlayerState>({
    id: 'dealer',
    name: 'Dealer',
    isAi: true,
    isSeen: false,
    hasFolded: false,
    totalBet: 50,
    cards: null,
    avatar: '🤵',
  });

  // Cards
  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [dealerCards, setDealerCards] = useState<Card[]>([]);

  // Animations & Visuals
  const [isDealingAnimation, setIsDealingAnimation] = useState<boolean>(false);
  const [isFlippingCards, setIsFlippingCards] = useState<boolean>(false);
  const [isRevealingDealer, setIsRevealingDealer] = useState<boolean>(false);
  const [chipFlyingToPot, setChipFlyingToPot] = useState<boolean>(false);
  const [winnerInfo, setWinnerInfo] = useState<{ id: string; name: string; hand: string; amount: number } | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sound sync
  useEffect(() => {
    teenPattiAudio.enabled = soundEnabled;
  }, [soundEnabled]);

  // Initial Auto-Deal on mount
  useEffect(() => {
    handleStartNewRound(50);
  }, []);

  const showNotification = (msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => setNoticeMessage(null), 3000);
  };

  // Start new round: Boot deduction & card deal
  const handleStartNewRound = async (stake: number = selectedChip) => {
    if (isDealingAnimation) return;
    setErrorMessage(null);
    setWinnerInfo(null);
    setGameState('DEALING');
    setIsDealingAnimation(true);
    setIsRevealingDealer(false);

    // Generate local deck & hands immediately for instant responsive animation
    const deck = shuffleDeck(createDeck());
    const dealtPlayer = [deck[0], deck[1], deck[2]];
    const dealtDealer = [deck[3], deck[4], deck[5]];

    setPlayerCards(dealtPlayer);
    setDealerCards(dealtDealer);

    setBootAmount(stake);
    setCurrentStake(stake);
    setTablePot(stake * 2); // Player + Dealer
    setRoundNumber((prev) => prev + 1);

    // Reset Player and Dealer
    setPlayer({
      id: user?.id || 'player-self',
      name: user?.username || 'You',
      isAi: false,
      isSeen: false,
      hasFolded: false,
      totalBet: stake,
      cards: dealtPlayer,
      avatar: '🧑',
    });

    setDealer({
      id: 'dealer',
      name: 'Dealer',
      isAi: true,
      isSeen: false,
      hasFolded: false,
      totalBet: stake,
      cards: null, // Hidden until showdown
      avatar: '🤵',
    });

    // Backend authoritative boot deduction
    try {
      await ApiClient.startTeenPattiBoot({ bootAmount: stake });
      refreshWallet();
    } catch {
      // Fallback
    }

    // Play card deal sounds in sequence
    setTimeout(() => teenPattiAudio.playDealSound(), 100);
    setTimeout(() => teenPattiAudio.playDealSound(), 350);
    setTimeout(() => teenPattiAudio.playDealSound(), 600);

    // Complete dealing transition
    setTimeout(() => {
      setIsDealingAnimation(false);
      setGameState('BETTING');
      teenPattiAudio.playChipSound();
      showNotification(`Round #${roundNumber + 1} Started! Boot ₹${stake} placed.`);
    }, 1100);
  };

  // Flip and See Cards action
  const handleSeeCards = async () => {
    if (player.isSeen) return;

    setIsFlippingCards(true);
    teenPattiAudio.playFlipSound();

    try {
      await ApiClient.performTeenPattiAction({ action: 'see' });
    } catch {
      // Fallback
    }

    setTimeout(() => {
      setPlayer((prev) => ({ ...prev, isSeen: true }));
      setIsFlippingCards(false);
      const evalResult = evaluateTeenPattiHand(playerCards);
      showNotification(`Cards Seen: ${evalResult.name}! Chaal stake is ₹${currentStake * 2}.`);
    }, 400);
  };

  // Action: Chaal or Blind Bet
  const handlePlaceBet = async (isBlind: boolean) => {
    if (gameState !== 'BETTING' || isDealingAnimation || player.hasFolded) return;

    // Blind bet is 1x currentStake, Seen (Chaal) is 2x currentStake
    const betAmount = isBlind ? currentStake : currentStake * 2;

    setChipFlyingToPot(true);
    teenPattiAudio.playChipSound();

    try {
      await ApiClient.performTeenPattiAction({
        action: isBlind ? 'blind' : 'chaal',
        amount: betAmount,
      });
      refreshWallet();
    } catch {
      // Preview mode
    }

    // Update Player & Dealer (Dealer automatically matches the bet into the Pot)
    setPlayer((prev) => ({ ...prev, totalBet: prev.totalBet + betAmount }));
    setDealer((prev) => ({ ...prev, totalBet: prev.totalBet + betAmount }));
    setTablePot((prev) => prev + betAmount * 2);

    setTimeout(() => {
      setChipFlyingToPot(false);
      teenPattiAudio.playChipSound();
    }, 400);
  };

  // Action: Pack (Fold)
  const handlePack = async () => {
    if (gameState !== 'BETTING') return;

    teenPattiAudio.playFoldSound();

    try {
      await ApiClient.performTeenPattiAction({ action: 'pack' });
    } catch {
      // Fallback
    }

    setPlayer((prev) => ({ ...prev, hasFolded: true }));
    setGameState('SETTLED');
    setWinnerInfo({
      id: 'dealer',
      name: 'Dealer',
      hand: 'Player Folded (Pack)',
      amount: tablePot,
    });
    showNotification('You folded (Packed). Hand surrendered to Dealer.');
  };

  // Action: Showdown (Show Cards)
  const handleShowdown = async () => {
    if (gameState !== 'BETTING') return;

    setGameState('SHOWDOWN');
    setIsRevealingDealer(true);
    teenPattiAudio.playShowdownFanfare();
    showNotification('SHOWDOWN! Revealing Dealer cards...');

    // Reveal Dealer cards with 3D flip animation
    setTimeout(() => {
      setDealer((prev) => ({ ...prev, cards: dealerCards, isSeen: true }));
      setPlayer((prev) => ({ ...prev, isSeen: true }));

      // Compare Player cards vs Dealer cards
      const comp = compareHands(playerCards, dealerCards);
      const playerWon = comp >= 0;

      const evalPlayer = evaluateTeenPattiHand(playerCards);
      const evalDealer = evaluateTeenPattiHand(dealerCards);

      setGameState('SETTLED');

      if (playerWon) {
        setWinnerInfo({
          id: player.id,
          name: player.name,
          hand: `${evalPlayer.name} (${evalPlayer.description})`,
          amount: tablePot,
        });

        teenPattiAudio.playWinFanfare();
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#eab308', '#22c55e', '#ec4899', '#3b82f6', '#ffffff'],
        });
        refreshWallet();
      } else {
        setWinnerInfo({
          id: 'dealer',
          name: 'Dealer',
          hand: `${evalDealer.name} (${evalDealer.description})`,
          amount: tablePot,
        });
        showNotification(`Dealer won with ${evalDealer.name}!`);
      }
    }, 900);
  };

  const myEvaluation = playerCards.length === 3 ? evaluateTeenPattiHand(playerCards) : null;
  const dealerEvaluation = dealerCards.length === 3 ? evaluateTeenPattiHand(dealerCards) : null;

  return (
    <div className="w-full px-2 py-1.5 space-y-2 text-zinc-100 pb-16 select-none font-sans">
      {/* 1. TOP HEADER BAR: Back Button, Room #, Table Pot, Rules & Sound */}
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
            <span>Table #{roundNumber}</span>
          </div>
        </div>

        {/* Central Live Pot Indicator */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-300 shadow-sm animate-pulse">
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[10px] uppercase font-bold text-zinc-400">Pot:</span>
          <span className="font-mono text-sm font-black text-amber-300">
            ₹{tablePot.toLocaleString()}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowRulesModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-zinc-300 hover:text-amber-300 transition rounded-lg hover:bg-zinc-800 text-[11px] font-semibold bg-zinc-800/60 border border-zinc-700/60"
            title="Official Teen Patti Rules & Hand Rankings"
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

      {/* Notifications / Alerts */}
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

      {/* 2. AUTHENTIC CASINO TEEN PATTI FELT TABLE (PLAYER VS DEALER ONLY) */}
      <div className="relative w-full rounded-2xl bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 border-4 border-amber-900/60 shadow-[inset_0_0_50px_rgba(0,0,0,0.8)] p-3 overflow-hidden flex flex-col justify-between min-h-[380px]">
        {/* Subtle Watermark on Felt */}
        <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
          <span className="text-5xl font-black font-serif text-amber-300 tracking-widest text-center">
            PLAYER VS DEALER
          </span>
        </div>

        {/* Table Felt Trim Border Line */}
        <div className="absolute inset-2 border border-emerald-500/20 rounded-xl pointer-events-none" />

        {/* =========================================================================
            TOP SECTION: DEALER (ONLY DEALER)
            ========================================================================= */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-9 h-9 rounded-full bg-zinc-900 border-2 border-amber-400/80 flex items-center justify-center text-lg shadow-md">
              {dealer.avatar}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black text-amber-200 uppercase tracking-wide">
                  Dealer
                </span>
                <span className="text-[9px] font-mono font-bold text-zinc-300 bg-zinc-900/80 px-1.5 py-0.2 rounded border border-zinc-700/60">
                  ₹{dealer.totalBet}
                </span>
              </div>
              <span className="text-[9px] text-emerald-400 font-medium block">
                {dealer.isSeen && dealerEvaluation ? dealerEvaluation.name : 'Dealer Hand'}
              </span>
            </div>
          </div>

          {/* Dealer's 3 Cards Container with 3D Flip & Reveal Animation */}
          <div className="flex items-center justify-center gap-2 mt-0.5">
            {[0, 1, 2].map((idx) => {
              const card = dealer.isSeen ? dealerCards[idx] : null;
              const rotationDegree = idx === 0 ? '-rotate-3' : idx === 2 ? 'rotate-3' : 'rotate-0';

              return (
                <div
                  key={idx}
                  className={`relative transition-all duration-500 transform ${rotationDegree} ${
                    isDealingAnimation
                      ? '-translate-y-8 opacity-0 scale-50'
                      : 'translate-y-0 opacity-100 scale-100'
                  }`}
                  style={{ perspective: '1000px' }}
                >
                  <div
                    className={`w-13 h-18 rounded-xl shadow-xl transition-all duration-500 transform ${
                      isRevealingDealer ? 'scale-105' : ''
                    } ${
                      card
                        ? 'bg-gradient-to-br from-white to-zinc-100 border-2 border-amber-400/80 text-zinc-950'
                        : 'bg-gradient-to-br from-red-800 via-rose-900 to-amber-950 border-2 border-amber-400/70 text-amber-300'
                    } flex flex-col justify-between p-1.5 select-none`}
                  >
                    {card ? (
                      <>
                        <div className="flex items-center justify-between leading-none">
                          <span className={`text-[11px] font-black ${SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                            {getRankLabel(card.rank)}
                          </span>
                          <span className={`text-[11px] leading-none ${SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                            {SUIT_SYMBOLS[card.suit]}
                          </span>
                        </div>
                        <div className="flex items-center justify-center my-auto">
                          <span
                            className={`text-xl leading-none ${
                              SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'
                            }`}
                          >
                            {SUIT_SYMBOLS[card.suit]}
                          </span>
                        </div>
                        <div className="flex items-center justify-end leading-none">
                          <span className={`text-[11px] font-black ${SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                            {getRankLabel(card.rank)}
                          </span>
                        </div>
                      </>
                    ) : (
                      /* Face-down Dealer Card Back */
                      <div className="w-full h-full border border-amber-400/40 rounded-lg flex flex-col items-center justify-center bg-radial from-red-900 to-zinc-950">
                        <span className="text-base text-amber-300/90 font-mono font-black drop-shadow">
                          🂠
                        </span>
                        <span className="text-[6px] font-black uppercase tracking-widest text-amber-400/80 mt-0.5">
                          CASINO
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* =========================================================================
            CENTER SECTION: POT CIRCLE & CHIPS
            ========================================================================= */}
        <div className="relative z-10 flex flex-col items-center justify-center my-2">
          <div className="relative flex items-center justify-center">
            {/* Glowing outer circle */}
            <div className="w-22 h-22 rounded-full border-2 border-dashed border-amber-400/50 bg-zinc-950/70 shadow-2xl flex flex-col items-center justify-center backdrop-blur-xs">
              <div className="flex items-center gap-1 text-amber-400 mb-0.5">
                <Coins className="w-3.5 h-3.5 animate-bounce" />
                <span className="text-[8px] uppercase font-black tracking-widest text-zinc-300">
                  Pot
                </span>
              </div>
              <span className="text-base font-black font-mono text-amber-300 drop-shadow-md">
                ₹{tablePot.toLocaleString()}
              </span>
              <span className="text-[8px] font-medium text-emerald-400">
                Stake: ₹{currentStake}
              </span>
            </div>

            {/* Flying Chip Animation Element */}
            {chipFlyingToPot && (
              <div className="absolute -bottom-6 w-6 h-6 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 border-2 border-white shadow-lg animate-ping pointer-events-none" />
            )}
          </div>
        </div>

        {/* =========================================================================
            WINNER SHOWDOWN ANNOUNCEMENT BANNER
            ========================================================================= */}
        {winnerInfo && (
          <div className="relative z-20 my-1 p-2 rounded-xl bg-gradient-to-r from-amber-600/30 via-yellow-500/30 to-emerald-600/30 border border-yellow-400/70 text-center animate-bounce shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-center gap-1.5 text-yellow-300 font-black text-sm">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <span>{winnerInfo.name.toUpperCase()} WINS ₹{winnerInfo.amount.toLocaleString()}!</span>
            </div>
            <div className="text-[10px] text-amber-200 font-bold mt-0.5">
              {winnerInfo.hand}
            </div>
          </div>
        )}

        {/* =========================================================================
            BOTTOM SECTION: PLAYER (YOU)
            ========================================================================= */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Hand Ranking Badge if Cards Seen */}
          {player.isSeen && myEvaluation && (
            <div className="mb-1.5 px-3 py-0.5 rounded-full bg-zinc-950/90 border border-amber-400/60 text-amber-300 text-[11px] font-bold shadow-md flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>{myEvaluation.name}: {myEvaluation.description}</span>
            </div>
          )}

          {/* Player's 3 Cards Container with 3D Flip & Deal Animation */}
          <div className="flex items-center justify-center gap-2">
            {playerCards.map((card, idx) => {
              const isSeen = player.isSeen || gameState === 'SETTLED' || gameState === 'SHOWDOWN';
              const rotationDegree = idx === 0 ? '-rotate-3' : idx === 2 ? 'rotate-3' : 'rotate-0';

              return (
                <div
                  key={idx}
                  className={`relative transition-all duration-500 transform ${rotationDegree} ${
                    isDealingAnimation
                      ? 'translate-y-8 opacity-0 scale-50'
                      : 'translate-y-0 opacity-100 scale-100'
                  }`}
                  style={{ perspective: '1000px' }}
                >
                  <div
                    className={`w-14 h-20 rounded-xl shadow-2xl transition-all duration-500 transform ${
                      isFlippingCards ? 'scale-105' : ''
                    } ${
                      isSeen
                        ? 'bg-gradient-to-br from-white to-zinc-100 border-2 border-amber-400/80 text-zinc-950'
                        : 'bg-gradient-to-br from-red-800 via-rose-900 to-amber-950 border-2 border-amber-400/70 text-amber-300'
                    } flex flex-col justify-between p-1.5 select-none`}
                  >
                    {isSeen ? (
                      <>
                        {/* Top corner rank + suit */}
                        <div className="flex items-center justify-between leading-none">
                          <span className={`text-xs font-black ${SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                            {getRankLabel(card.rank)}
                          </span>
                          <span className={`text-xs leading-none ${SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                            {SUIT_SYMBOLS[card.suit]}
                          </span>
                        </div>

                        {/* Center big suit symbol */}
                        <div className="flex items-center justify-center my-auto">
                          <span
                            className={`text-2xl leading-none drop-shadow-sm ${
                              SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'
                            }`}
                          >
                            {SUIT_SYMBOLS[card.suit]}
                          </span>
                        </div>

                        {/* Bottom corner rank */}
                        <div className="flex items-center justify-end leading-none">
                          <span className={`text-xs font-black ${SUIT_COLORS[card.suit] === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>
                            {getRankLabel(card.rank)}
                          </span>
                        </div>
                      </>
                    ) : (
                      /* Face-down Authentic Card Back */
                      <div className="w-full h-full border border-amber-400/40 rounded-lg flex flex-col items-center justify-center bg-radial from-red-900 to-zinc-950">
                        <span className="text-xl text-amber-300/90 font-mono font-black drop-shadow">
                          🂠
                        </span>
                        <span className="text-[7px] font-black uppercase tracking-widest text-amber-400/80 mt-0.5">
                          BLIND
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* See Cards Quick Action Button if Playing Blind */}
          {!player.isSeen && gameState === 'BETTING' && !isDealingAnimation && (
            <button
              onClick={handleSeeCards}
              className="mt-2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-black shadow-md shadow-amber-500/30 transition active:scale-95 animate-pulse"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>See Cards (కార్డ్స్ చూడండి)</span>
            </button>
          )}

          {/* Player Info Status */}
          <div className="mt-1 flex items-center gap-2 text-xs font-bold text-zinc-300">
            <span>You: <strong className="text-amber-300 font-mono">₹{player.totalBet}</strong></span>
            <span>•</span>
            <span className={player.isSeen ? 'text-emerald-400' : 'text-yellow-400'}>
              {player.isSeen ? 'SEEN' : 'BLIND'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. CHIP SELECTOR BAR */}
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
                teenPattiAudio.playChipSound();
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

      {/* 4. PRIMARY CONTROLS ACTION PANEL */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-2.5 space-y-2 shadow-xl">
        {gameState === 'SETTLED' ? (
          /* New Round Action */
          <button
            onClick={() => handleStartNewRound(selectedChip)}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-zinc-950 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-98 transition"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Next Round (₹{selectedChip} Boot)</span>
          </button>
        ) : (
          /* Live Round Actions: Chaal, Blind, Pack, Showdown */
          <div className="grid grid-cols-3 gap-2">
            {/* Pack / Fold */}
            <button
              onClick={handlePack}
              disabled={gameState !== 'BETTING' || isDealingAnimation}
              className="py-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/80 border border-red-800/60 text-red-200 font-bold text-xs uppercase transition active:scale-95 disabled:opacity-50"
            >
              Pack (Fold)
            </button>

            {/* Showdown (Show) */}
            <button
              onClick={handleShowdown}
              disabled={gameState !== 'BETTING' || isDealingAnimation}
              className="py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs uppercase transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              <span>Show</span>
            </button>

            {/* Main Bet Button: Blind or Chaal */}
            {!player.isSeen ? (
              <button
                onClick={() => handlePlaceBet(true)}
                disabled={gameState !== 'BETTING' || isDealingAnimation}
                className="py-2.5 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-zinc-950 font-black text-xs uppercase shadow-md shadow-amber-500/20 transition active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center leading-tight"
              >
                <span>Blind</span>
                <span className="font-mono text-[10px]">₹{currentStake}</span>
              </button>
            ) : (
              <button
                onClick={() => handlePlaceBet(false)}
                disabled={gameState !== 'BETTING' || isDealingAnimation}
                className="py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-zinc-950 font-black text-xs uppercase shadow-md shadow-emerald-500/20 transition active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center leading-tight"
              >
                <span>Chaal</span>
                <span className="font-mono text-[10px]">₹{currentStake * 2}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 5. OFFICIAL TEEN PATTI RULES & HAND RANKINGS MODAL */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md max-h-[88vh] bg-zinc-950 border border-amber-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-zinc-800 bg-zinc-900/60">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-amber-200 uppercase tracking-wider font-serif">
                  Teen Patti Official Rules & Rankings
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
                onClick={() => setActiveRulesTab('ranks')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeRulesTab === 'ranks'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Hand Rankings (1-6)
              </button>
              <button
                onClick={() => setActiveRulesTab('rules')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeRulesTab === 'rules'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Game Rules
              </button>
              <button
                onClick={() => setActiveRulesTab('payouts')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeRulesTab === 'payouts'
                    ? 'bg-amber-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Side Payouts
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs leading-relaxed text-zinc-300">
              {activeRulesTab === 'ranks' && (
                <div className="space-y-2.5">
                  <p className="text-[11px] text-zinc-400">
                    In Teen Patti, hands are ranked from highest (Rank 1) to lowest (Rank 6):
                  </p>

                  {/* 1. Trail */}
                  <div className="bg-zinc-900 border border-amber-500/40 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-black border border-amber-500/40">
                          1
                        </span>
                        <strong className="text-amber-200 font-bold">Trail / Trio / Set</strong>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold">HIGHEST</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      Three cards of the exact same rank. <strong>A-A-A</strong> is highest, <strong>2-2-2</strong> is lowest.
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 font-mono font-bold border border-zinc-700">A♠</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">A♥</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">A♦</span>
                    </div>
                  </div>

                  {/* 2. Pure Sequence */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-[10px] font-black">
                          2
                        </span>
                        <strong className="text-zinc-100 font-bold">Pure Sequence (Straight Flush)</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      Three consecutive cards of the same suit. <strong>A-K-Q</strong> is highest, followed by <strong>A-2-3</strong>, down to 4-3-2.
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">K♥</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">Q♥</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">J♥</span>
                    </div>
                  </div>

                  {/* 3. Sequence */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-[10px] font-black">
                          3
                        </span>
                        <strong className="text-zinc-100 font-bold">Sequence / Normal Run</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      Three consecutive cards of mixed suits. <strong>A-K-Q</strong> is highest.
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 font-mono font-bold border border-zinc-700">A♠</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">K♦</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 font-mono font-bold border border-zinc-700">Q♣</span>
                    </div>
                  </div>

                  {/* 4. Color / Flush */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-[10px] font-black">
                          4
                        </span>
                        <strong className="text-zinc-100 font-bold">Color / Flush</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      Three cards of the same suit not in sequence.
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">K♦</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">9♦</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">4♦</span>
                    </div>
                  </div>

                  {/* 5. Pair */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-[10px] font-black">
                          5
                        </span>
                        <strong className="text-zinc-100 font-bold">Pair (Double)</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      Two cards of identical rank. Pair of Aces is the highest pair.
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 font-mono font-bold border border-zinc-700">10♠</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-red-400 font-mono font-bold border border-zinc-700">10♥</span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 font-mono font-bold border border-zinc-700">5♣</span>
                    </div>
                  </div>

                  {/* 6. High Card */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-[10px] font-black">
                          6
                        </span>
                        <strong className="text-zinc-100 font-bold">High Card</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      When no other pattern is formed. Highest single card determines strength.
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'rules' && (
                <div className="space-y-3">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">1. Heads-Up Format</h4>
                    <p className="text-zinc-400 text-[11px]">
                      Pure 1-on-1 clash between Player and Dealer. No third-party players or interference.
                    </p>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">2. Boot Stake</h4>
                    <p className="text-zinc-400 text-[11px]">
                      Player and Dealer both contribute the Boot amount into the center Pot to start the round.
                    </p>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">3. Blind vs. Seen Play</h4>
                    <p className="text-zinc-400 text-[11px]">
                      Play <strong>Blind</strong> with cards face-down for half stake, or click <strong>See Cards</strong> to view your hand and play <strong>Chaal</strong>.
                    </p>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    <h4 className="font-bold text-amber-300">4. Showdown (Show)</h4>
                    <p className="text-zinc-400 text-[11px]">
                      Click <strong>Show</strong> to reveal the Dealer's cards. Higher hand rank wins the entire Pot!
                    </p>
                  </div>
                </div>
              )}

              {activeRulesTab === 'payouts' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-zinc-400">
                    Teen Patti Hand Rank Payout Multipliers:
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Trail (AAA)</span>
                      <span className="text-amber-400 font-mono font-black text-sm">40x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Pure Sequence</span>
                      <span className="text-emerald-400 font-mono font-black text-sm">20x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Sequence (Run)</span>
                      <span className="text-cyan-400 font-mono font-black text-sm">8x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Color (Flush)</span>
                      <span className="text-purple-400 font-mono font-black text-sm">4x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">Pair</span>
                      <span className="text-blue-400 font-mono font-black text-sm">2x Payout</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
                      <span className="text-[10px] text-zinc-400 block font-bold">High Card</span>
                      <span className="text-zinc-400 font-mono font-black text-sm">1x Payout</span>
                    </div>
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
