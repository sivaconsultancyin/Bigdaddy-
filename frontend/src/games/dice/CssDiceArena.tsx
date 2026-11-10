import React from 'react';
import { Sparkles, Trophy } from 'lucide-react';

interface CssDiceArenaProps {
  isRolling: boolean;
  rollValue: number | null; // Authoritative server result: 1 to 10
  won: boolean | null;
  status: 'BETTING' | 'ROLLING' | 'RESULT';
}

/**
 * Lucky 10 uses one authoritative server number (1..10), not a pair of dice.
 * Never synthesize dice values from the total: the visible face displays
 * exactly the value supplied by the server after the round reaches RESULT.
 */
export const CssDiceArena: React.FC<CssDiceArenaProps> = ({
  isRolling,
  rollValue,
  won,
  status,
}) => {
  const hasAuthoritativeResult =
    status === 'RESULT' &&
    Number.isInteger(rollValue) &&
    rollValue !== null &&
    rollValue >= 1 &&
    rollValue <= 10;

  return (
    <div className="w-full relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-4 sm:p-6 shadow-2xl flex flex-col items-center justify-center min-h-[190px]">
      <style>{`
        @keyframes lucky10DieRoll {
          0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateY(0); }
          20% { transform: rotateX(210deg) rotateY(160deg) rotateZ(35deg) translateY(-20px); }
          45% { transform: rotateX(430deg) rotateY(320deg) rotateZ(95deg) translateY(-4px); }
          70% { transform: rotateX(650deg) rotateY(520deg) rotateZ(170deg) translateY(-18px); }
          100% { transform: rotateX(900deg) rotateY(720deg) rotateZ(260deg) translateY(0); }
        }
        @keyframes lucky10DieFloat {
          0%, 100% { transform: translateY(0) rotateX(-8deg) rotateY(-12deg); }
          50% { transform: translateY(-5px) rotateX(-8deg) rotateY(-12deg); }
        }
        .lucky10-die-rolling { animation: lucky10DieRoll 0.85s linear infinite; }
        .lucky10-die-idle { animation: lucky10DieFloat 2.6s ease-in-out infinite; }
        .lucky10-die-face {
          position: absolute;
          width: 88px;
          height: 88px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #d4d4d8;
          border-radius: 16px;
          background: linear-gradient(145deg, #fff, #f4f4f5 58%, #d4d4d8);
          color: #18181b;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 42px;
          font-weight: 900;
          box-shadow: inset 0 0 12px rgba(0,0,0,.12), 0 5px 14px rgba(0,0,0,.35);
          backface-visibility: hidden;
        }
      `}</style>

      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="w-64 h-36 rounded-full bg-amber-500/5 blur-2xl" />
        <div className="w-56 h-28 rounded-full border border-dashed border-amber-500/20" />
      </div>

      <div className="relative z-10 flex items-center justify-center py-3" style={{ perspective: '900px' }}>
        <div
          className={`relative w-[88px] h-[88px] ${isRolling ? 'lucky10-die-rolling' : 'lucky10-die-idle'}`}
          style={{ transformStyle: 'preserve-3d' }}
          role="img"
          aria-label={
            hasAuthoritativeResult
              ? `Server result number ${rollValue}`
              : status === 'ROLLING'
                ? 'Dice rolling; result hidden'
                : 'Dice ready; waiting for server result'
          }
        >
          <div
            className="lucky10-die-face"
            style={{
              transform: 'translateZ(44px)',
              borderColor: hasAuthoritativeResult && won ? '#10b981' : '#d4d4d8',
              boxShadow: hasAuthoritativeResult && won
                ? 'inset 0 0 12px rgba(16,185,129,.25), 0 0 24px rgba(16,185,129,.35)'
                : undefined,
            }}
          >
            {hasAuthoritativeResult ? rollValue : '?'}
          </div>
          <div className="lucky10-die-face" style={{ transform: 'rotateY(180deg) translateZ(44px)', background: 'linear-gradient(145deg,#f4f4f5,#a1a1aa)' }} />
          <div className="lucky10-die-face" style={{ transform: 'rotateY(90deg) translateZ(44px)', background: 'linear-gradient(145deg,#e4e4e7,#a1a1aa)' }} />
          <div className="lucky10-die-face" style={{ transform: 'rotateY(-90deg) translateZ(44px)', background: 'linear-gradient(145deg,#fafafa,#a1a1aa)' }} />
          <div className="lucky10-die-face" style={{ transform: 'rotateX(90deg) translateZ(44px)', background: 'linear-gradient(145deg,#fff,#a1a1aa)' }} />
          <div className="lucky10-die-face" style={{ transform: 'rotateX(-90deg) translateZ(44px)', background: 'linear-gradient(145deg,#e4e4e7,#a1a1aa)' }} />
        </div>
      </div>

      <div className="relative z-10 mt-2 flex flex-col items-center">
        {status === 'ROLLING' && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold animate-pulse shadow-lg">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-400" />
            <span>ROLLING DICE (డైస్ రోల్ అవుతోంది)...</span>
          </div>
        )}

        {status === 'RESULT' && hasAuthoritativeResult && (
          <div
            className={`flex items-center gap-2 px-4 py-1.5 rounded-2xl border shadow-xl transition-all duration-300 scale-105 ${
              won
                ? 'bg-gradient-to-r from-emerald-950 via-emerald-900 to-zinc-950 border-emerald-400 text-emerald-200 shadow-[0_0_25px_rgba(16,185,129,0.5)]'
                : 'bg-gradient-to-r from-amber-950 via-zinc-900 to-zinc-950 border-amber-400 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
            }`}
          >
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-xs uppercase font-sans font-bold text-zinc-300">Server result:</span>
              <span className="text-lg font-black text-amber-300">#{rollValue}</span>
            </div>
            {won && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-black uppercase">
                YOU WON!
              </span>
            )}
          </div>
        )}

        {status === 'RESULT' && !hasAuthoritativeResult && (
          <div className="px-3 py-1 rounded-xl bg-red-950/60 border border-red-500/50 text-red-300 text-xs font-semibold">
            Server result unavailable — please wait for sync
          </div>
        )}

        {status === 'BETTING' && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-zinc-900/90 border border-zinc-800 text-zinc-300 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-0.5" />
            <span className="text-emerald-400 font-bold">READY TO ROLL</span>
            <span className="text-zinc-500">•</span>
            <span className="text-zinc-400 text-[11px]">నంబర్లు 1-10 ఎంచుకోండి</span>
          </div>
        )}
      </div>
    </div>
  );
};
