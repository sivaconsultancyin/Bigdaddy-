import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import { GameInfo, LedgerEntry, TokenRequest, TokenRequestStatus } from '../../../shared/src/types';
import { TokenRequestModal } from '../components/common/TokenRequestModal';
import { AviatorGame } from '../games/aviator/AviatorGame';
import { RoulettePreview } from '../games/roulette/RoulettePreview';
import { TeenPattiPreview } from '../games/teen-patti/TeenPattiPreview';
import { DicePreview } from '../games/dice/DicePreview';
import { DragonTigerPreview } from '../games/dragon-tiger/DragonTigerPreview';
import { AndarBaharPreview } from '../games/andar-bahar/AndarBaharPreview';
import {
  Coins,
  Gamepad2,
  User as UserIcon,
  Sparkles,
  Plane,
  Disc,
  Club,
  Dice5,
  Flame,
  Layers,
  ArrowRight,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Share2,
  ShieldCheck,
  LogOut,
} from 'lucide-react';

export const PlayerDashboard: React.FC = () => {
  const { user, wallet, refreshWallet, logout } = useAuth();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [activeGameCode, setActiveGameCode] = useState<string | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [requests, setRequests] = useState<TokenRequest[]>([]);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [activeCard, setActiveCard] = useState<'all' | 'games' | 'wallet' | 'profile'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    ApiClient.getGames()
      .then((data) => setGames(data.games))
      .catch(() => {});

    ApiClient.getLedger()
      .then((data) => setLedgerEntries(data.entries))
      .catch(() => {});

    ApiClient.getTokenRequests()
      .then((data) => setRequests(data.requests))
      .catch(() => {});
  }, []);

  const handleCopyReferral = () => {
    if (user?.referralCode) {
      navigator.clipboard.writeText(user.referralCode);
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 2000);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshWallet();
    const [ledg, reqs] = await Promise.all([
      ApiClient.getLedger().catch(() => ({ entries: [] })),
      ApiClient.getTokenRequests().catch(() => ({ requests: [] })),
    ]);
    if (ledg.entries) setLedgerEntries(ledg.entries);
    if (reqs.requests) setRequests(reqs.requests);
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const getGameIcon = (iconName: string) => {
    switch (iconName) {
      case 'Plane':
        return <Plane className="w-5 h-5 text-amber-400" />;
      case 'Disc':
        return <Disc className="w-5 h-5 text-rose-400" />;
      case 'Club':
        return <Club className="w-5 h-5 text-emerald-400" />;
      case 'Dice5':
        return <Dice5 className="w-5 h-5 text-blue-400" />;
      case 'Flame':
        return <Flame className="w-5 h-5 text-amber-500" />;
      case 'Layers':
      default:
        return <Layers className="w-5 h-5 text-purple-400" />;
    }
  };

  // If a game screen is opened, render it within the mobile frame
  if (activeGameCode === 'aviator') {
    return <AviatorGame onBackToLobby={() => setActiveGameCode(null)} />;
  }

  const selectedGame = games.find((g) => g.code === activeGameCode);
  if (selectedGame) {
    if (selectedGame.code === 'roulette') {
      return <RoulettePreview game={selectedGame} onBack={() => setActiveGameCode(null)} />;
    }
    if (selectedGame.code === 'teen-patti') {
      return <TeenPattiPreview game={selectedGame} onBack={() => setActiveGameCode(null)} />;
    }
    if (selectedGame.code === 'dice') {
      return <DicePreview game={selectedGame} onBack={() => setActiveGameCode(null)} />;
    }
    if (selectedGame.code === 'dragon-tiger') {
      return <DragonTigerPreview game={selectedGame} onBack={() => setActiveGameCode(null)} />;
    }
    if (selectedGame.code === 'andar-bahar') {
      return <AndarBaharPreview game={selectedGame} onBack={() => setActiveGameCode(null)} />;
    }
  }

  return (
    <div className="w-full px-3 py-3 space-y-3.5 pb-20">
      {/* Mobile 3-Card Filter Pills */}
      <div className="flex items-center justify-between gap-1 p-1 bg-zinc-900/90 rounded-2xl border border-zinc-800 text-xs">
        <button
          onClick={() => setActiveCard('all')}
          className={`flex-1 py-1.5 rounded-xl text-center font-bold transition ${
            activeCard === 'all'
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setActiveCard('games')}
          className={`flex-1 py-1.5 rounded-xl text-center font-bold flex items-center justify-center gap-1 transition ${
            activeCard === 'games'
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Gamepad2 className="w-3.5 h-3.5" />
          <span>Games</span>
        </button>
        <button
          onClick={() => setActiveCard('wallet')}
          className={`flex-1 py-1.5 rounded-xl text-center font-bold flex items-center justify-center gap-1 transition ${
            activeCard === 'wallet'
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>Wallet</span>
        </button>
        <button
          onClick={() => setActiveCard('profile')}
          className={`flex-1 py-1.5 rounded-xl text-center font-bold flex items-center justify-center gap-1 transition ${
            activeCard === 'profile'
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <UserIcon className="w-3.5 h-3.5" />
          <span>Profile</span>
        </button>
      </div>

      {/* =========================================================================
          CARD 1: GAMES CARD
          ========================================================================= */}
      {(activeCard === 'all' || activeCard === 'games') && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3.5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <Gamepad2 className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-amber-200 font-serif uppercase tracking-wider">
                Casino Games
              </h2>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              1 Active
            </span>
          </div>

          {/* Featured Live Game: Aviator / Crash */}
          <div className="bg-gradient-to-br from-amber-950/40 via-zinc-900 to-zinc-950 border border-amber-500/40 rounded-xl p-3 mb-2.5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center text-white shadow-md">
                  <Plane className="w-5 h-5 text-white animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-sm text-zinc-100">Aviator / Crash</span>
                    <span className="text-[8px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 uppercase">
                      ● LIVE
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 block">
                    Multiplier flight curve · Instant cashout
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono bg-zinc-950/70 rounded-lg px-2.5 py-1.5 border border-zinc-800/80 mb-2.5">
              <span className="text-zinc-400">Min Bet: 10 Tokens</span>
              <span className="text-amber-400 font-bold">Max: 100,000</span>
            </div>

            <button
              onClick={() => setActiveGameCode('aviator')}
              className="w-full py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
            >
              <span>Play Aviator Now</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Upcoming Games Grid (Compact mobile 2-col) */}
          <div className="grid grid-cols-2 gap-2">
            {games
              .filter((g) => g.code !== 'aviator')
              .map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGameCode(g.code)}
                  className="bg-zinc-900/70 border border-zinc-800 hover:border-zinc-700 rounded-xl p-2.5 text-left transition flex flex-col justify-between active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center">
                      {getGameIcon(g.iconName)}
                    </div>
                    <span className="text-[8px] uppercase font-bold px-1 rounded bg-zinc-800 text-zinc-500">
                      Soon
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block truncate leading-tight">
                      {g.name}
                    </span>
                    <span className="text-[9px] text-zinc-500 font-mono">
                      Pool: {parseInt(g.poolBalance || '0').toLocaleString()}
                    </span>
                  </div>
                </button>
              ))}
          </div>
        </section>
      )}

      {/* =========================================================================
          CARD 2: WALLET CARD
          ========================================================================= */}
      {(activeCard === 'all' || activeCard === 'wallet') && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3.5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <Coins className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-amber-200 font-serif uppercase tracking-wider">
                My Wallet
              </h2>
            </div>
            <button
              onClick={handleManualRefresh}
              className="p-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-amber-400 transition"
              title="Refresh wallet"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>

          {/* Balance Display */}
          <div className="bg-gradient-to-r from-zinc-900 to-zinc-900/60 rounded-xl p-3 border border-zinc-800 mb-3">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 uppercase font-semibold mb-1">
              <span>Available Chips</span>
              <span className="text-[8px] font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                SIMULATED TOKENS
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-amber-300 tracking-tight flex items-center gap-1.5 mb-1">
              <Coins className="w-5 h-5 text-amber-400" />
              <span>{wallet ? parseInt(wallet.balance).toLocaleString() : '0'}</span>
            </div>
            <span className="text-[10px] text-zinc-500 block leading-tight">
              Isolated in-memory balance. No real-money deposit needed.
            </span>
          </div>

          {/* Wallet Actions */}
          <button
            onClick={() => setIsRequestModalOpen(true)}
            className="w-full py-2.5 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-sm transition active:scale-[0.98] mb-3"
          >
            + Request Additional Chips from Admin
          </button>

          {/* Recent Ledger History Header */}
          <div className="pt-2 border-t border-zinc-900">
            <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 mb-2">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Recent Ledger Entries</span>
              </div>
              <span className="text-[9px] text-zinc-500 font-mono">Double-Entry</span>
            </div>

            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
              {ledgerEntries.length === 0 ? (
                <div className="text-center py-4 text-[11px] text-zinc-500">
                  No transaction history recorded yet
                </div>
              ) : (
                ledgerEntries.slice(0, 5).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                      <span
                        className={`text-[8px] font-mono font-bold px-1 rounded ${
                          e.direction === 'CREDIT'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {e.direction}
                      </span>
                      <span className="text-zinc-300 truncate">{e.description}</span>
                    </div>
                    <span
                      className={`font-mono font-bold shrink-0 ${
                        e.direction === 'CREDIT' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {e.direction === 'CREDIT' ? '+' : '-'}
                      {parseInt(e.amount).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* =========================================================================
          CARD 3: PROFILE CARD
          ========================================================================= */}
      {(activeCard === 'all' || activeCard === 'profile') && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3.5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <UserIcon className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-amber-200 font-serif uppercase tracking-wider">
                Player Profile
              </h2>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Verified
            </span>
          </div>

          {/* Account Details */}
          <div className="space-y-2 mb-3 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-400">Username:</span>
              <span className="font-bold text-zinc-100">{user?.username}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-400">Account Role:</span>
              <span className="font-mono font-bold text-emerald-400">{user?.role}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-400">Responsible Agent:</span>
              <span className="text-zinc-300">Admin Bravo</span>
            </div>
          </div>

          {/* Referral Code Share Widget */}
          <div className="bg-gradient-to-r from-amber-950/30 to-zinc-900 p-2.5 rounded-xl border border-amber-500/20 mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 text-[11px] text-amber-300 font-bold">
                <Share2 className="w-3.5 h-3.5" />
                <span>My Referral Code</span>
              </div>
              <span className="text-[9px] text-zinc-500">Invite Friends</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-zinc-950 border border-amber-500/40 rounded-lg px-2.5 py-1 text-center font-mono font-black text-amber-300 text-xs tracking-wider">
                {user?.referralCode || 'BIGDADDY777'}
              </div>
              <button
                onClick={handleCopyReferral}
                className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition flex items-center gap-1 shrink-0"
              >
                {copiedReferral ? <Check className="w-3 h-3 text-emerald-950" /> : <Copy className="w-3 h-3" />}
                <span>{copiedReferral ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Sign Out Button */}
          <button
            onClick={logout}
            className="w-full py-2 rounded-xl text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out of Player Account</span>
          </button>
        </section>
      )}

      {/* Token Request Modal */}
      <TokenRequestModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        onRequestSubmitted={handleManualRefresh}
      />
    </div>
  );
};
