import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { UserRole } from '../../../../shared/src/types';
import { Coins, Home, RefreshCw, Sparkles, User as UserIcon, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

interface HeaderProps {
  onOpenTokenRequest?: () => void;
  onGoToLobby?: () => void;
  onOpenProfile?: () => void;
  onOpenDeposit?: () => void;
  onOpenWithdrawal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTokenRequest, onGoToLobby, onOpenProfile, onOpenDeposit, onOpenWithdrawal }) => {
  const { user, wallet, refreshWallet } = useAuth();
  const { apiHealth } = useWebSocket();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const isPlayer = user?.role === UserRole.PLAYER;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshWallet();
    setIsRefreshing(false);
  };

  const formattedBalance = React.useMemo(() => {
    if (!wallet) return '0';
    try { return BigInt(wallet.balance).toLocaleString(); }
    catch { return wallet.balance; }
  }, [wallet?.balance]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-amber-500/20 bg-zinc-950/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 w-full min-w-0 items-center justify-between gap-1.5 px-2 sm:px-3">
        <div className="flex min-w-0 shrink items-center gap-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-300/40 bg-gradient-to-br from-amber-400 via-amber-600 to-yellow-700 shadow-md shadow-amber-500/20"><Sparkles className="h-4 w-4 text-zinc-950" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 leading-none"><span className="truncate bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-xs font-extrabold uppercase tracking-wide text-transparent sm:text-sm">BigDaddy</span><span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider text-amber-400">{isPlayer ? 'GAMES' : 'PORTAL'}</span></div>
            {!isPlayer && <div className="mt-1 flex items-center gap-1 text-[9px] text-zinc-500"><span className={apiHealth === 'online' ? 'text-emerald-400' : apiHealth === 'degraded' ? 'text-amber-400' : apiHealth === 'offline' ? 'text-rose-400' : 'text-zinc-500'}>● {apiHealth === 'online' ? 'API Online' : apiHealth === 'degraded' ? 'API Degraded' : apiHealth === 'offline' ? 'API Offline' : 'Checking'}</span><span>·</span><span className="max-w-[70px] truncate text-zinc-400">{user?.username}</span></div>}
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <div className="flex shrink-0 items-center rounded-full border border-amber-500/30 bg-zinc-900/90 py-1 pl-1.5 pr-1 shadow-inner">
            <span className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/20 text-amber-400"><Coins className="h-3 w-3" /></span>
            <div className="mr-0.5 text-right"><div className="text-[7px] font-bold uppercase leading-none text-zinc-500">{isPlayer ? 'Balance' : user?.role === UserRole.OWNER ? 'Treasury' : 'Chips'}</div><div className="flex items-center gap-0.5 font-mono text-[10px] font-black leading-tight tracking-tight text-amber-300"><span>{formattedBalance}</span><button onClick={handleRefresh} title="Refresh balance" aria-label="Refresh balance" className="p-0.5 text-zinc-500"><RefreshCw className={`h-2.5 w-2.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} /></button></div></div>
            {!isPlayer && user?.role !== UserRole.OWNER && onOpenTokenRequest && <button onClick={onOpenTokenRequest} className="ml-1 shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-zinc-950">+</button>}
          </div>
          {isPlayer ? (
            <>
              <button onClick={onOpenDeposit} aria-label="Open deposit page" className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[9px] font-bold text-emerald-300"><ArrowDownToLine className="h-3 w-3" /><span>Deposit</span></button>
              <button onClick={onOpenWithdrawal} aria-label="Open withdrawal page" className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-1.5 text-[9px] font-bold text-rose-300"><ArrowUpFromLine className="h-3 w-3" /><span>Withdraw</span></button>
              <button onClick={onOpenProfile} aria-label="Open profile" title="Profile" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-300"><UserIcon className="h-4 w-4" /></button>
            </>
          ) : (
            <button onClick={onGoToLobby} title="Dashboard" className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-bold text-amber-300"><Home className="h-3.5 w-3.5" /><span>Dashboard</span></button>
          )}
        </div>
      </div>
    </header>
  );
};
