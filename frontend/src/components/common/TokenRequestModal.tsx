import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ApiClient } from '../../api/client';
import { Coins, X, CheckCircle, AlertCircle } from 'lucide-react';
import { UserRole } from '../../../../shared/src/types';
import { PlayerAdminPaymentCard } from './PlayerAdminPaymentCard';

interface TokenRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestSubmitted?: () => void;
}

export const TokenRequestModal: React.FC<TokenRequestModalProps> = ({
  isOpen,
  onClose,
  onRequestSubmitted,
}) => {
  const { user, refreshWallet } = useAuth();
  const [amount, setAmount] = useState('1000');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const getApproverTitle = () => {
    if (user?.role === UserRole.PLAYER) return 'Responsible Admin';
    if (user?.role === UserRole.ADMIN) return 'Super Admin (Parent)';
    if (user?.role === UserRole.SUPER_ADMIN) return 'Owner (Treasury)';
    return 'Approver';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await ApiClient.createTokenRequest({
        amount,
        note,
      });
      setSuccess(`Request submitted successfully for ${amount} tokens.`);
      await refreshWallet();
      if (onRequestSubmitted) onRequestSubmitted();
      setTimeout(() => {
        onClose();
        setSuccess(null);
        setNote('');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to submit token request');
    } finally {
      setLoading(false);
    }
  };

  const presetAmounts = ['500', '1000', '5000', '10000', '50000'];

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
            <h3 className="text-lg font-bold text-amber-300 font-serif">Request Tokens</h3>
            <p className="text-xs text-zinc-400">
              Submitted to your hierarchical parent ({getApproverTitle()})
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

        {/* If Player, show Admin Payment QR photo and UPI ID */}
        {user?.role === UserRole.PLAYER && (
          <div className="mb-4">
            <PlayerAdminPaymentCard onRequestTokens={() => {}} compact={true} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Token Amount
            </label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-4 py-2.5 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
              placeholder="e.g. 5000"
              required
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {presetAmounts.map((p) => (
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

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Reason / Note (Optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-4 py-2.5 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none h-20"
              placeholder="e.g. Chips for evening high-roller session"
            />
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
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
