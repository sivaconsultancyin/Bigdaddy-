import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { UserRole } from '../../../../shared/src/types';
import { Coins, Home, RefreshCw, Wifi, WifiOff, Sparkles, User as UserIcon } from 'lucide-react';

interface HeaderProps {
  onOpenTokenRequest?: () => void;
  onGoToLobby?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTokenRequest, onGoToLobby }) => {
  const { user, wallet, refreshWallet } = useAuth();
  const { apiHealth } = useWebSocket();
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshWallet();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const formattedBalance = React.useMemo(() => {
    if (!wallet) return '0';
    try {
      const b = BigInt(wallet.balance);
      return b.toLocaleString();
    } catch {
      return wallet.balance;
    }
  }, [wallet?.balance]);

  const getRoleBadge = (role?: UserRole) => {
    switch (role) {
      case UserRole.OWNER:
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case UserRole.SUPER_ADMIN:
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case UserRole.ADMIN:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case UserRole.PLAYER:
      default:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    }
  };

  return (
    <header className="bg-zinc-950/95 backdrop-blur-md border-b border-amber-500/20 sticky top-0 z-40 w-full">
      <div className="w-full px-3 h-14 flex items-center justify-between gap-2">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 via-amber-600 to-yellow-700 flex items-center justify-center shadow-md shadow-amber-500/20 border border-amber-300/40">
            <Sparkles className="w-4 h-4 text-zinc-950" />
          </div>
          <div>
            <div className="flex items-center gap-1 leading-none">
              <span className="font-extrabold text-sm tracking-wide bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent uppercase font-serif">
                BigDaddy
              </span>
              <span className="text-[8px] uppercase font-bold tracking-wider px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                {user?.role === UserRole.PLAYER ? 'GAMES' : 'PORTAL'}
              </span>
            </div>
            <div className="text-[9px] text-zinc-500 flex items-center gap-1 mt-0.5">
              {apiHealth === 'online' ? (
                <span className="flex items-center gap-0.5 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> API Online
                </span>
              ) : apiHealth === 'degraded' ? (
                <span className="flex items-center gap-0.5 text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span> API Degraded
                </span>
              ) : apiHealth === 'offline' ? (
                <span className="flex items-center gap-0.5 text-rose-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span> API Offline
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-zinc-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse"></span> Checking
                </span>
              )}
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400 truncate max-w-[70px]">{user?.username}</span>
            </div>
          </div>
        </div>

        {/* Right Section: Mobile Balance Pill & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Wallet Balance Pill */}
          <div className="flex items-center bg-zinc-900/90 border border-amber-500/30 rounded-full pl-2 pr-1.5 py-1 shadow-inner">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center mr-1.5 text-amber-400 border border-amber-500/30 shrink-0">
              <Coins className="w-3 h-3" />
            </div>
            <div className="text-right mr-1">
              <div className="text-[8px] text-zinc-500 font-bold uppercase leading-none">
                {user?.role === UserRole.OWNER ? 'Treasury' : 'Chips'}
              </div>
              <div className="text-xs font-black text-amber-300 font-mono tracking-tight flex items-center gap-0.5 leading-tight">
                <span>{formattedBalance}</span>
                <button
                  onClick={handleRefresh}
                  title="Refresh balance"
                  className="text-zinc-500 hover:text-amber-400 transition p-0.5"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
                </button>
              </div>
            </div>

            {/* Request Tokens CTA for Non-Owners */}
            {user?.role !== UserRole.OWNER && onOpenTokenRequest && (
              <button
                onClick={onOpenTokenRequest}
                className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 text-[10px] font-bold px-2 py-0.5 rounded-full transition shadow-sm shadow-amber-500/20 shrink-0"
              >
                +
              </button>
            )}
          </div>

          {/* Lobby / Dashboard Button */}
          <button
            onClick={onGoToLobby}
            title={user?.role === UserRole.PLAYER ? 'Lobby' : 'Dashboard'}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gradient-to-r from-amber-500/20 via-yellow-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-yellow-500/30 border border-amber-500/40 text-amber-300 hover:text-amber-200 rounded-lg transition active:scale-95 text-[11px] font-bold shrink-0 shadow-sm shadow-amber-500/10 cursor-pointer"
          >
            <Home className="w-3.5 h-3.5 text-amber-400" />
            <span>{user?.role === UserRole.PLAYER ? 'Lobby' : 'Dashboard'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
