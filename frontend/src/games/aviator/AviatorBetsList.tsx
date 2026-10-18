import React from 'react';
import { AviatorBet, BetStatus } from '../../../../shared/src/types';
import { Users, Sparkles } from 'lucide-react';

interface AviatorBetsListProps {
  bets: AviatorBet[];
}

export const AviatorBetsList: React.FC<AviatorBetsListProps> = ({ bets }) => {
  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-2 shadow-md flex flex-col h-full max-h-[300px]">
      <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800/80 text-[10px]">
        <div className="flex items-center gap-1 font-bold text-zinc-300">
          <Users className="w-3 h-3 text-amber-400" />
          <span>Active Players ({bets.length})</span>
        </div>
        <span className="text-[9px] text-zinc-500 font-mono">Real-Time</span>
      </div>

      <div className="flex-1 overflow-y-auto mt-1 space-y-1 pr-0.5 scrollbar-thin">
        {bets.length === 0 ? (
          <div className="text-center py-4 text-[10px] text-zinc-500">
            No bets placed yet for this round
          </div>
        ) : (
          bets.map((bet) => {
            const isWon = bet.status === BetStatus.WON;
            const isLost = bet.status === BetStatus.LOST;

            return (
              <div
                key={bet.id}
                className={`flex items-center justify-between px-2 py-1 rounded-lg text-[10px] transition border ${
                  isWon
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : isLost
                    ? 'bg-rose-950/20 border-rose-500/20 text-zinc-500'
                    : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                  <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-400 shrink-0">
                    {bet.username.substring(0, 2).toUpperCase()}
                  </div>
                  <span className="font-semibold truncate">{bet.username}</span>
                  {bet.autoCashoutMultiplier && (
                    <span className="text-[8px] text-amber-400/80 font-mono shrink-0">
                      @{bet.autoCashoutMultiplier}x
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 font-mono shrink-0">
                  <span className="text-zinc-400">{parseInt(bet.betAmount).toLocaleString()}</span>
                  {isWon ? (
                    <div className="flex items-center gap-0.5 text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 text-[9px]">
                      <Sparkles className="w-2.5 h-2.5" />
                      <span>{bet.cashedOutMultiplier}x</span>
                    </div>
                  ) : isLost ? (
                    <span className="text-rose-500 text-[9px]">Crashed</span>
                  ) : (
                    <span className="text-zinc-500 text-[9px] animate-pulse">In Flight</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
