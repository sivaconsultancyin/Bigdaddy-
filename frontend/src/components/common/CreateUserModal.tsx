import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ApiClient } from '../../api/client';
import { UserPlus, X, CheckCircle, AlertCircle, Shield } from 'lucide-react';
import { UserRole } from '../../../../shared/src/types';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated?: () => void;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  isOpen,
  onClose,
  onUserCreated,
}) => {
  const { user, refreshWallet } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [initialTokens, setInitialTokens] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  // Derive allowed subordinate role
  let targetRole = UserRole.PLAYER;
  let targetTitle = 'Player';
  if (user?.role === UserRole.OWNER) {
    targetRole = UserRole.SUPER_ADMIN;
    targetTitle = 'Super Admin';
  } else if (user?.role === UserRole.SUPER_ADMIN) {
    targetRole = UserRole.ADMIN;
    targetTitle = 'Admin';
  } else if (user?.role === UserRole.ADMIN) {
    targetRole = UserRole.PLAYER;
    targetTitle = 'Player';
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      await ApiClient.createUser({
        username,
        email,
        password,
        role: targetRole,
        initialTokens,
      });

      setSuccess(`${targetTitle} ${username} created successfully!`);
      await refreshWallet();
      if (onUserCreated) onUserCreated();
      setTimeout(() => {
        onClose();
        setSuccess(null);
        setUsername('');
        setEmail('');
        setPassword('');
        setInitialTokens('0');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

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
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center border border-purple-500/30">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-amber-300 font-serif">Create New {targetTitle}</h3>
            <p className="text-xs text-zinc-400">
              Assigned directly to your hierarchy tree ({user?.username})
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

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3.5 py-2 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="e.g. VIP_Highroller"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3.5 py-2 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="e.g. account@casino.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3.5 py-2 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="Minimum 6 characters"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              Initial Token Allocation (Debited from your wallet)
            </label>
            <input
              type="number"
              min="0"
              value={initialTokens}
              onChange={(e) => setInitialTokens(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3.5 py-2 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
              placeholder="0"
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
              className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : `Register ${targetTitle}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
