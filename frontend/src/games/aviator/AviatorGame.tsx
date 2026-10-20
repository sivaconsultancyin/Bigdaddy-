import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../../context/WebSocketContext';
import { AviatorCanvas } from './AviatorCanvas';
import { AviatorBetPanel } from './AviatorBetPanel';
import { AviatorBetsList } from './AviatorBetsList';
import { AviatorBet, BetStatus } from '../../../../shared/src/types';
import { ApiClient } from '../../api/client';
import { ShieldCheck, ArrowLeft, Users, ChevronDown, ChevronUp, X, CheckCircle2, AlertTriangle } from 'lucide-react';

interface AviatorGameProps {
  onBackToLobby?: () => void;
}

interface BetResultNotice {
  id: string;
  kind: 'win' | 'loss';
  amount: string;
  roundId: string;
}

export const AviatorGame: React.FC<AviatorGameProps> = ({ onBackToLobby }) => {
  const { multiplier, roundState, recentHistory } = useWebSocket();
  const [bets, setBets] = useState<AviatorBet[]>([]);
  const [bet1, setBet1] = useState<AviatorBet | null>(null);
  const [bet2, setBet2] = useState<AviatorBet | null>(null);
  const [showBetsDrawer, setShowBetsDrawer] = useState(false);
  const [showFairnessModal, setShowFairnessModal] = useState(false);
  const [resultNotice, setResultNotice] = useState<BetResultNotice | null>(null);
  const seenLossRoundsRef = useRef<Set<string>>(new Set());
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showResultNotice = (notice: BetResultNotice) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setResultNotice(notice);
    noticeTimerRef.current = setTimeout(() => setResultNotice(null), 3500);
  };

  // Fetch initial round bets
  useEffect(() => {
    ApiClient.getAviatorState()
      .then((data) => {
        if (data.bets) setBets(data.bets);
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  // A pending personal bet at an authoritative crash is a loss. Show at most one
  // compact notice per round, and never label an already-cashed-out bet as lost.
  useEffect(() => {
    if (roundState.status !== 'CRASHED' || !roundState.id) return;
    if (seenLossRoundsRef.current.has(roundState.id)) return;

    const lostBets = [bet1, bet2].filter(
      (bet): bet is AviatorBet => !!bet && bet.status === BetStatus.PENDING
    );
    if (lostBets.length === 0) return;

    seenLossRoundsRef.current.add(roundState.id);
    const totalLost = lostBets.reduce((sum, bet) => sum + Math.max(0, Number(bet.betAmount) || 0), 0);
    showResultNotice({
      id: `loss-${roundState.id}`,
      kind: 'loss',
      amount: totalLost.toLocaleString(),
      roundId: roundState.id,
    });
  }, [roundState.status, roundState.id, bet1, bet2]);

  // Reset active bets when round changes to WAITING
  useEffect(() => {
    if (roundState.status === 'WAITING') {
      setBet1(null);
      setBet2(null);
    }
  }, [roundState.status]);

  const handleBetPlaced = (bet: AviatorBet, panel: 1 | 2) => {
    if (panel === 1) setBet1(bet);
    else setBet2(bet);
    setBets((prev) => [bet, ...prev]);
  };

  const handleBetCashedOut = (bet: AviatorBet, panel: 1 | 2) => {
    if (panel === 1) setBet1(bet);
    else setBet2(bet);
    setBets((prev) => prev.map((b) => (b.id === bet.id ? bet : b)));

    // Only show a win notice after the cashout API returns the settled winning bet.
    if (bet.status === BetStatus.WON) {
      showResultNotice({
        id: `win-${bet.id}`,
        kind: 'win',
        amount: Number(bet.winAmount || '0').toLocaleString(),
        roundId: bet.roundId || roundState.id || '',
      });
    }
  };

  const getMultiplierBadgeColor = (val: number) => {
    if (val >= 10.0) return 'bg-amber-500/20 text-amber-300 border-amber-500/50';
    if (val >= 2.0) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    return 'bg-zinc-800 text-zinc-400 border-zinc-700/60';
  };

  return (
    <div className="w-full px-2 py-1.5 space-y-1.5 text-zinc-100 pb-4 relative">
      {/* Compact result popup stays inside the Aviator game screen. */}
      {resultNotice && (
        <div
          key={resultNotice.id}
          role="status"
          aria-live="polite"
          className={`absolute top-12 left-1/2 -translate-x-1/2 z-40 w-[min(84%,320px)] rounded-xl border px-3 py-2.5 shadow-2xl backdrop-blur-md animate-fadeIn ${
            resultNotice.kind === 'win'
              ? 'bg-emerald-950/95 border-emerald-400/60 text-emerald-100 shadow-emerald-950/50'
              : 'bg-rose-950/95 border-rose-400/60 text-rose-100 shadow-rose-950/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${
              resultNotice.kind === 'win' ? 'bg-emerald-400/15' : 'bg-rose-400/15'
            }`}>
              {resultNotice.kind === 'win'
                ? <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                : <AlertTriangle className="w-5 h-5 text-rose-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-black uppercase tracking-wider ${
                resultNotice.kind === 'win' ? 'text-emerald-300' : 'text-rose-300'
              }`}>
                {resultNotice.kind === 'win' ? 'You Won!' : 'Bet Lost'}
              </div>
              <div className="text-sm font-bold">
                {resultNotice.kind === 'win' ? '+' : '−'}{resultNotice.amount} chips
              </div>
            </div>
            <button
              type="button"
              onClick={() => setResultNotice(null)}
              aria-label="Close result popup"
              className="shrink-0 rounded-md p-1 text-zinc-300 hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top Mobile Bar: Back Button, Multipliers History & Provably Fair */}
      <div className="flex items-center justify-between gap-1 bg-zinc-900/85 border border-zinc-800/80 rounded-xl px-2 py-1">
        <div className="flex items-center gap-1 shrink-0">
          {onBackToLobby && (
            <button
              onClick={onBackToLobby}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-semibold transition active:scale-95"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Lobby</span>
            </button>
          )}
          <div className="w-px h-4 bg-zinc-800 mx-0.5"></div>
        </div>

        <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5 px-0.5">
          {recentHistory.slice(-6).map((h, i) => (
            <span
              key={i}
              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md border shrink-0 leading-none ${getMultiplierBadgeColor(h.crashMultiplier)}`}
            >
              {h.crashMultiplier.toFixed(2)}x
            </span>
          ))}
        </div>

        <button
          onClick={() => setShowFairnessModal(true)}
          className="p-1 text-zinc-400 hover:text-amber-300 transition rounded-lg hover:bg-zinc-800/60 shrink-0"
          title="Provably Fair"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        </button>
      </div>

      <div className="w-full">
        <AviatorCanvas status={roundState.status} multiplier={multiplier} />
      </div>

      <div className="w-full space-y-2">
        <AviatorBetPanel
          panelIndex={1}
          status={roundState.status}
          currentMultiplier={multiplier}
          activeBet={bet1}
          onBetPlaced={(b) => handleBetPlaced(b, 1)}
          onBetCashedOut={(b) => handleBetCashedOut(b, 1)}
        />
        <AviatorBetPanel
          panelIndex={2}
          status={roundState.status}
          currentMultiplier={multiplier}
          activeBet={bet2}
          onBetPlaced={(b) => handleBetPlaced(b, 2)}
          onBetCashedOut={(b) => handleBetCashedOut(b, 2)}
        />
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowBetsDrawer(!showBetsDrawer)}
          className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3 text-amber-400" />
            <span className="font-bold">Active Flight Bets ({bets.length})</span>
          </div>
          {showBetsDrawer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showBetsDrawer && (
          <div className="p-1.5 border-t border-zinc-800 max-h-40 overflow-y-auto">
            <AviatorBetsList bets={bets} />
          </div>
        )}
      </div>

      {showFairnessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3">
          <div className="bg-zinc-950 border border-amber-500/30 w-full max-w-[360px] rounded-2xl p-3.5 shadow-2xl relative text-zinc-100">
            <button
              onClick={() => setShowFairnessModal(false)}
              className="absolute top-2.5 right-2.5 text-zinc-400 hover:text-zinc-100 p-1"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h4 className="font-bold text-xs text-amber-300 font-serif">Provably Fair & Game Pool</h4>
            </div>
            <p className="text-[11px] text-zinc-300 leading-relaxed mb-2.5">
              Aviator engine uses cryptographic SHA-256 crash seeds generated before flight launch.
              Complies strictly with 97% Return to Player (RTP) curves.
            </p>
            <div className="bg-zinc-900 rounded-lg p-2 text-[10px] text-zinc-400 space-y-1 border border-zinc-800 font-mono">
              <div>• Round ID: {roundState.id || 'Active'}</div>
              <div>• Dedicated Pool: Aviator Isolated Pool</div>
              <div>• Settlement: Stakes held in Escrow; net winnings paid by Pool</div>
              <div>• Supply Limit: Exactly 10 Billion Max Tokens</div>
            </div>
            <div className="mt-2.5 text-right">
              <button
                onClick={() => setShowFairnessModal(false)}
                className="px-3.5 py-1 rounded-lg text-xs font-bold bg-amber-500 text-zinc-950 transition active:scale-95"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
