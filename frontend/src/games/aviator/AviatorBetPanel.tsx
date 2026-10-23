import React, { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ApiClient } from '../../api/client';
import { AviatorBet, BetStatus } from '../../../../shared/src/types';
import confetti from 'canvas-confetti';
import { Sparkles, Check, AlertCircle } from 'lucide-react';

interface AviatorBetPanelProps {
  panelIndex: number;
  status: 'WAITING' | 'RUNNING' | 'CRASHED' | 'SETTLED';
  currentMultiplier: number;
  activeBet: AviatorBet | null;
  onBetPlaced: (bet: AviatorBet) => void;
  onBetCashedOut: (bet: AviatorBet) => void;
}

export const AviatorBetPanel: React.FC<AviatorBetPanelProps> = ({
  panelIndex,
  status,
  currentMultiplier,
  activeBet,
  onBetPlaced,
  onBetCashedOut,
}) => {
  const { refreshWallet } = useAuth();
  const [betAmount, setBetAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingBetRequest = useRef<{ amount: string; key: string } | null>(null);

  const handlePlaceBet = async () => {
    setError(null);
    setLoading(true);

    try {
      // Reuse the same key for a retry of the same amount, so network retries
      // cannot create a second bet. A changed amount gets a fresh key.
      if (!pendingBetRequest.current || pendingBetRequest.current.amount !== betAmount) {
        pendingBetRequest.current = { amount: betAmount, key: 'aviator-bet-' + crypto.randomUUID() };
      }
      const requestKey = pendingBetRequest.current.key;
      const res = await ApiClient.placeAviatorBet({ amount: betAmount }, requestKey);

      pendingBetRequest.current = null;
      // The bet is confirmed by the server; update the game UI immediately.
      // Wallet refresh is secondary and must not keep the bet button in loading state.
      onBetPlaced(res.bet);
      void refreshWallet().catch(() => undefined);
    } catch (err: any) {
      setError(err.message || 'Failed to place bet');
    } finally {
      setLoading(false);
    }
  };

  const handleCashout = async () => {
    if (!activeBet) return;
    setError(null);
    setLoading(true);

    try {
      const res = await ApiClient.cashoutAviatorBet({
        betId: activeBet.id,
      });

      // The backend returns { result: { betId, status, payoutAmount, cashoutMultiplier } },
      // not { bet }. Merge the authoritative settlement into the existing bet so
      // the parent game never receives undefined (which can crash the whole screen).
      const result = res?.result;
      if (!result || result.betId !== activeBet.id || result.status !== BetStatus.WON) {
        throw new Error('Cashout response was incomplete. Refresh the game state before retrying.');
      }

      const settledBet: AviatorBet = {
        ...activeBet,
        status: BetStatus.WON,
        winAmount: String(result.payoutAmount ?? activeBet.winAmount ?? '0'),
        cashedOutMultiplier: result.cashoutMultiplier != null
          ? Number(result.cashoutMultiplier)
          : currentMultiplier,
      };
      onBetCashedOut(settledBet);
      // Wallet refresh is secondary; do not block the game UI on it.
      void refreshWallet().catch(() => undefined);

      confetti({
        particleCount: 40,
        spread: 45,
        origin: { y: 0.8 },
      });
    } catch (err: any) {
      setError(err.message || 'Cashout failed');
    } finally {
      setLoading(false);
    }
  };

  const currentPayout = activeBet
    ? Math.floor(parseInt(activeBet.betAmount, 10) * currentMultiplier).toLocaleString()
    : '0';

  const adjustBet = (delta: number) => {
    const val = Math.max(10, parseInt(betAmount || '0', 10) + delta);
    setBetAmount(val.toString());
  };

  const multiplyBet = (factor: number) => {
    const val = Math.max(10, Math.floor(parseInt(betAmount || '0', 10) * factor));
    setBetAmount(val.toString());
  };

  const isPending = !!activeBet && activeBet.status === BetStatus.PENDING;

  return (
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-xl p-2 shadow-md">
      {/* Top Bar: Panel Label + Quick Chip Multipliers */}
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          <span className="text-[10px] font-extrabold text-zinc-300 uppercase tracking-wider">
            Bet {panelIndex}
          </span>
        </div>

        {/* Compact Quick Adjustment Chips */}
        {!isPending && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => adjustBet(50)}
              className="text-[8px] font-bold h-4.5 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0 transition active:scale-95"
            >
              +50
            </button>
            <button
              type="button"
              onClick={() => adjustBet(100)}
              className="text-[8px] font-bold h-4.5 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0 transition active:scale-95"
            >
              +100
            </button>
            <button
              type="button"
              onClick={() => multiplyBet(2)}
              className="text-[8px] font-bold h-4.5 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0 transition active:scale-95"
            >
              2X
            </button>
            <button
              type="button"
              onClick={() => multiplyBet(0.5)}
              className="text-[8px] font-bold h-4.5 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0 transition active:scale-95"
            >
              ½
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-1.5 p-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[9px] flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Side-by-Side (Pakapakkana) Bet Input & Action Button */}
      <div className="flex items-center gap-1.5">
        {/* Left Side: Compact Stepper Input (Size thagginchi) */}
        <div className="w-[45%] shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => adjustBet(-10)}
            disabled={isPending}
            className="h-9 w-6 rounded-l-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs flex items-center justify-center border-y border-l border-zinc-700 transition active:scale-95 disabled:opacity-40 shrink-0"
          >
            -
          </button>
          <input
            type="number"
            min="10"
            disabled={isPending}
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            className="w-full min-w-0 bg-zinc-950 border-y border-zinc-700 focus:border-amber-500 h-9 px-1 text-zinc-100 font-mono text-xs font-bold focus:outline-none text-center"
          />
          <button
            type="button"
            onClick={() => adjustBet(10)}
            disabled={isPending}
            className="h-9 w-6 rounded-r-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs flex items-center justify-center border-y border-r border-zinc-700 transition active:scale-95 disabled:opacity-40 shrink-0"
          >
            +
          </button>
        </div>

        {/* Right Side: Action Button (Side-by-side) */}
        <div className="flex-1 min-w-0">
          {/* State 1: Active Bet & Round Running -> Cashout Button */}
          {isPending && status === 'RUNNING' && (
            <button
              type="button"
              onClick={handleCashout}
              disabled={loading}
              aria-live="polite"
              className={`w-full h-9 rounded-lg font-black text-[11px] uppercase tracking-wide bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 text-zinc-950 shadow-md shadow-amber-500/30 transition-all flex flex-col items-center justify-center leading-tight active:scale-95 px-1 ${loading ? 'opacity-80 cursor-wait' : 'animate-pulse'}`}
            >
              <span className="font-black text-[11px]">{loading ? 'CASHING OUT…' : 'CASHOUT'}</span>
              <span className="text-[9px] font-mono font-black truncate">
                {loading ? 'CONFIRMING WITH SERVER' : `${currentPayout} (${currentMultiplier.toFixed(2)}x)`}
              </span>
            </button>
          )}

          {/* State 2: Active Bet & Round Waiting */}
          {isPending && status === 'WAITING' && (
            <div className="w-full h-9 rounded-lg flex items-center justify-center gap-1 bg-zinc-850 bg-zinc-800/80 border border-amber-500/40 text-amber-300 font-bold text-[9px] px-1 text-center leading-tight">
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="truncate">PLACED: {parseInt(activeBet.betAmount).toLocaleString()}</span>
            </div>
          )}

          {/* State 3: Active Bet Crashed */}
          {isPending && status === 'CRASHED' && (
            <div className="w-full h-9 rounded-lg flex items-center justify-center bg-rose-950/50 border border-rose-500/40 text-rose-300 font-bold text-[9px] px-1 text-center truncate">
              <span>CRASHED ({parseInt(activeBet.betAmount).toLocaleString()})</span>
            </div>
          )}

          {/* State 4: Cashed Out Won */}
          {activeBet && activeBet.status === BetStatus.WON && (
            <div className="w-full h-9 rounded-lg flex items-center justify-center gap-1 bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 font-bold text-[9px] px-1 text-center truncate">
              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="truncate">WON +{parseInt(activeBet.winAmount || '0').toLocaleString()}</span>
            </div>
          )}

          {/* State 5: No Active Bet -> Place Bet CTA */}
          {!isPending && activeBet?.status !== BetStatus.WON && (
            <button
              type="button"
              onClick={handlePlaceBet}
              disabled={status !== 'WAITING' || loading}
              className={`w-full h-9 rounded-lg font-black text-[11px] uppercase tracking-wide transition flex items-center justify-center px-1 truncate ${
                status === 'WAITING'
                  ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 text-zinc-950 shadow-md shadow-emerald-500/20 active:scale-95'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
              }`}
            >
              {loading ? (
                'PLACING...'
              ) : status === 'WAITING' ? (
                `BET ${parseInt(betAmount || '0').toLocaleString()}`
              ) : (
                'WAIT ROUND'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
