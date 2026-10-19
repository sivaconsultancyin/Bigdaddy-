import React, { useState } from 'react';
import { ApiClient } from '../../api/client';
import { ShieldCheck, X, CheckCircle, AlertCircle, Coins } from 'lucide-react';
import { GameInfo } from '../../../../shared/src/types';

interface AllocatePoolModalProps {
  isOpen: boolean;
  games: GameInfo[];
  onClose: () => void;
  onAllocated?: () => void;
}

export const AllocatePoolModal: React.FC<AllocatePoolModalProps> = ({
  isOpen,
  games,
  onClose,
  onAllocated,
}) => {
  const [selectedGameId, setSelectedGameId] = useState(games[0]?.id || 'game-aviator');
  const [amount, setAmount] = useState('1000000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const selectedGame = games.find((game) => game.id === selectedGameId);
      await ApiClient.allocatePool({
        gameId: selectedGameId,
        gameCode: selectedGame?.code || 'aviator',
        amount,
      });

      setSuccess(`Successfully allocated ${parseInt(amount).toLocaleString()} tokens from Treasury to Game Pool!`);
      if (onAllocated) onAllocated();
      setTimeout(() => {
        onClose();
        setSuccess(null);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Allocation failed');
    } finally {
      setLoading(false);
    }
  };

  const presets = ['500000', '1000000', '5000000', '10000000'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3">
      <div className="bg-zinc-950 border border-amber-500/30 w-full max-w-[390px] rounded-2xl p-4 shadow-2xl relative text-zinc-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-900 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-amber-300 font-serif">Allocate Pool Liquidity</h3>
            <p className="text-xs text-zinc-400">
              Transfer reserves from Owner Treasury into isolated Game Pool
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Select Destination Game Pool
            </label>
            <select
              value={selectedGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} (Current Pool: {parseInt(g.poolBalance || '0').toLocaleString()} tokens)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Allocation Amount (Tokens)
            </label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
              required
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition ${
                    amount === p
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  +{parseInt(p).toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
            >
              {loading ? 'Allocating...' : 'Confirm Allocation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
