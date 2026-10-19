import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import { AppMode } from '../../../shared/src/types';
import {
  Sparkles,
  Lock,
  User as UserIcon,
  AlertCircle,
  Share2,
  CheckCircle,
  X,
} from 'lucide-react';

export const Login: React.FC = () => {
  const { login, loading, configInfo } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Referral Registration Modal State
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [refUsername, setRefUsername] = useState('');
  const [refEmail, setRefEmail] = useState('');
  const [refPassword, setRefPassword] = useState('');
  const [refCode, setRefCode] = useState('BIGDADDY777');
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [refSuccess, setRefSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login({ username, password });
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  };

  const handleReferralRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRefError(null);
    setRefSuccess(null);
    setRefLoading(true);

    try {
      await ApiClient.registerReferral({
        username: refUsername,
        email: refEmail,
        password: refPassword,
        referralCode: refCode,
      });

      setRefSuccess('Account created via referral! Logging in...');
      setTimeout(async () => {
        await login({ username: refUsername, password: refPassword });
      }, 1000);
    } catch (err: any) {
      setRefError(err.message || 'Registration failed');
    } finally {
      setRefLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-zinc-950 flex flex-col justify-center px-4 py-6 relative overflow-hidden text-zinc-100">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-600 to-yellow-700 flex items-center justify-center mx-auto mb-2.5 shadow-lg shadow-amber-500/20 border border-amber-300/40">
            <Sparkles className="w-7 h-7 text-zinc-950" />
          </div>
          <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent uppercase font-serif">
            BigDaddy Games
          </h1>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <span className="text-[9px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30 uppercase tracking-widest font-mono font-bold">
              {configInfo?.mode === AppMode.PRODUCTION ? 'Production · Persistent' : configInfo?.isSimulated ? 'Preview Mode · Simulated' : 'Connecting...'}
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 mt-1">
            Mobile-first authoritative casino gaming platform
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-zinc-900/90 border border-amber-500/30 rounded-2xl p-4 shadow-xl backdrop-blur-xl mb-4">
          {error && (
            <div className="mb-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Username</label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 focus:border-amber-500 rounded-xl px-3 py-2 pl-9 text-zinc-100 text-xs focus:outline-none"
                  placeholder="Enter your username"
                  required
                />
                <UserIcon className="w-4 h-4 text-zinc-500 absolute left-2.5 top-2.5" />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Password</label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 focus:border-amber-500 rounded-xl px-3 py-2 pl-9 text-zinc-100 text-xs focus:outline-none"
                  placeholder="Enter your password"
                  required
                />
                <Lock className="w-4 h-4 text-zinc-500 absolute left-2.5 top-2.5" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-md shadow-amber-500/20 transition active:scale-[0.98] disabled:opacity-50 uppercase tracking-wider min-h-[44px]"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          {/* Referral Registration CTA */}
          <div className="mt-3.5 pt-3 border-t border-zinc-800 text-center">
            <button
              onClick={() => setShowReferralModal(true)}
              className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold inline-flex items-center gap-1 transition"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Have a referral code? Register</span>
            </button>
          </div>
        </div>
      </div>

      {/* Referral Modal */}
      {showReferralModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3">
          <div className="bg-zinc-950 border border-amber-500/30 w-full max-w-[390px] rounded-2xl p-4 shadow-2xl relative text-zinc-100 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowReferralModal(false)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-100 p-1"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <Share2 className="w-4 h-4 text-amber-400" />
              <h3 className="font-bold text-sm text-amber-300 font-serif">
                Referral Registration
              </h3>
            </div>

            <p className="text-[11px] text-zinc-400 mb-3">
              Registration requires a sponsor code. You will be registered as a Player.
            </p>

            {refError && (
              <div className="mb-3 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{refError}</span>
              </div>
            )}

            {refSuccess && (
              <div className="mb-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{refSuccess}</span>
              </div>
            )}

            <form onSubmit={handleReferralRegister} className="space-y-2.5">
              <div>
                <label className="text-[10px] font-semibold text-zinc-300 block mb-0.5">
                  Referral Code
                </label>
                <input
                  type="text"
                  value={refCode}
                  onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
                  placeholder="e.g. BIGDADDY777"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-zinc-300 block mb-0.5">Username</label>
                <input
                  type="text"
                  value={refUsername}
                  onChange={(e) => setRefUsername(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-zinc-100"
                  placeholder="e.g. LuckyAce7"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-zinc-300 block mb-0.5">Email</label>
                <input
                  type="email"
                  value={refEmail}
                  onChange={(e) => setRefEmail(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-zinc-100"
                  placeholder="e.g. player@casino.com"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-zinc-300 block mb-0.5">Password</label>
                <input
                  type="password"
                  value={refPassword}
                  onChange={(e) => setRefPassword(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-zinc-100"
                  placeholder="Minimum 6 characters"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReferralModal(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refLoading}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition"
                >
                  {refLoading ? 'Creating...' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
