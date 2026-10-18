import React from 'react';
import { ArrowLeft, Clock, Club } from 'lucide-react';
import { GameInfo } from '../../../../shared/src/types';

export const TeenPattiPreview: React.FC<{ game: GameInfo; onBack: () => void }> = ({ game, onBack }) => {
  return (
    <div className="w-full px-3 py-3 space-y-3 text-zinc-100 pb-20">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition active:scale-95"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Lobby</span>
      </button>

      <div className="bg-zinc-950 border border-amber-500/30 rounded-2xl p-4 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
            <Club className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-black text-amber-300 font-serif">{game.name}</h2>
              <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Coming Soon
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">{game.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Status</span>
            <span className="text-amber-400 font-bold text-xs">Under Development</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Game Pool</span>
            <span className="text-zinc-200 font-mono font-bold text-xs">
              {parseInt(game.poolBalance || '0').toLocaleString()}
            </span>
          </div>
          <div className="col-span-2 bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Chip Limits</span>
            <span className="text-zinc-200 font-mono font-bold text-xs">
              {game.minBet} - {parseInt(game.maxBet).toLocaleString()} Tokens
            </span>
          </div>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 text-[11px] text-zinc-300 space-y-1.5">
          <h4 className="font-bold text-zinc-100 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Multiplayer Card Architecture</span>
          </h4>
          <p className="leading-relaxed text-zinc-400">
            India's favorite 3-card game with real-time tables, Chaal, Blind, and Showdown mechanics.
            Table pots and payouts are settled atomically from the Teen Patti Game Pool.
          </p>
        </div>
      </div>
    </div>
  );
};
