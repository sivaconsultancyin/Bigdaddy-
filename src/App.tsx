import React, { useState } from 'react';
import { AuthProvider, useAuth } from '../frontend/src/context/AuthContext';
import { WebSocketProvider } from '../frontend/src/context/WebSocketContext';
import { Header } from '../frontend/src/components/common/Header';
import { TokenRequestModal } from '../frontend/src/components/common/TokenRequestModal';
import { MobileBottomNav, MobileTab } from '../frontend/src/components/common/MobileBottomNav';
import { MobileDashboard } from '../frontend/src/pages/MobileDashboard';
import { PlayerProfilePage } from '../frontend/src/pages/PlayerProfilePage';
import { PlayerDepositPage } from '../frontend/src/pages/PlayerDepositPage';
import { PlayerWithdrawalPage } from '../frontend/src/pages/PlayerWithdrawalPage';
import { Login } from '../frontend/src/pages/Login';
import { AlertTriangle } from 'lucide-react';
import { ApiStatusBanner } from '../frontend/src/components/common/ApiStatusBanner';
import { UserRole } from '../shared/src/types';

const MainLayout: React.FC = () => {
  const { user, loading, refreshWallet, refreshUser, configError, authError } = useAuth();
  const [activeTab, setActiveTab] = useState<MobileTab>('games');
  const [activeGameCode, setActiveGameCode] = useState<string | null>(null);
  const [isTokenRequestOpen, setIsTokenRequestOpen] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState<number>(0);
  const isPlayer = user?.role === UserRole.PLAYER;

  if (configError) {
    return (
      <div className="min-h-screen w-full bg-zinc-950 flex justify-center items-center p-3 text-center">
        <div className="w-full max-w-[430px] bg-zinc-950 border border-rose-500/30 rounded-3xl p-6 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-7 h-7" /></div>
          <h1 className="text-xl font-bold text-rose-300 font-serif mb-2">Production Configuration Error</h1>
          <p className="text-xs text-zinc-400 leading-relaxed mb-4">The system was booted in Production Mode, but required production credentials are missing. Mock data and simulated settlements are strictly forbidden in Production Mode.</p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-[11px] font-mono text-zinc-300 text-left mb-4 whitespace-pre-wrap">{configError}</div>
          <div className="text-[11px] text-zinc-500">For development preview, set <code className="text-amber-400 font-mono">APP_MODE=development</code> in <code className="text-zinc-300 font-mono">.env</code>.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen w-full bg-zinc-950 flex justify-center items-center p-4"><div className="w-full max-w-[430px] flex flex-col items-center justify-center text-zinc-400"><div className="w-10 h-10 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin mb-3" /><div className="text-[11px] uppercase tracking-widest font-mono text-amber-300">Loading BigDaddy Games...</div></div></div>;
  }

  if (!user) {
    const verificationUnavailable = Boolean(authError?.startsWith('Could not verify your session:'));
    if (verificationUnavailable) {
      return <div className="min-h-screen w-full bg-zinc-950 flex justify-center items-center p-4"><div className="w-full max-w-[430px] bg-zinc-950 border border-amber-500/30 rounded-3xl p-6 text-center shadow-2xl"><div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-6 h-6" /></div><h1 className="text-lg font-bold text-amber-200 mb-2">Session verification temporarily unavailable</h1><p role="alert" className="text-xs text-zinc-300 leading-relaxed break-words mb-4">The server could not verify your saved session. Your login token has been kept; you do not need to sign in again.</p><button type="button" onClick={() => void refreshUser()} className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-bold text-zinc-950 active:scale-[0.99]">Retry session check</button></div></div>;
    }
    return <div className="min-h-screen w-full bg-zinc-950 flex justify-center items-start"><div className="w-full max-w-[430px] min-h-screen bg-zinc-950 border-x border-zinc-800/60 shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col relative overflow-x-hidden">{authError && <div role="alert" className="mx-4 mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 break-words">{authError}</div>}<Login /></div></div>;
  }

  const playerNavigate = (tab: MobileTab) => {
    setActiveGameCode(null);
    setActiveTab(tab);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-zinc-950 flex justify-center items-start selection:bg-amber-500 selection:text-zinc-950 font-sans overflow-x-hidden">
      <div className="w-full max-w-[430px] min-h-[100dvh] bg-zinc-950 border-x border-zinc-800/60 shadow-[0_0_60px_rgba(0,0,0,0.9)] flex flex-col relative overflow-x-hidden">
        <Header
          onOpenTokenRequest={() => setIsTokenRequestOpen(true)}
          onGoToLobby={() => playerNavigate('games')}
          onOpenProfile={() => playerNavigate('profile')}
          onOpenDeposit={() => playerNavigate('deposit')}
          onOpenWithdrawal={() => playerNavigate('withdrawal')}
        />
        <main className="flex-1 min-w-0">
          {isPlayer && activeTab === 'profile' ? (
            <PlayerProfilePage onBack={() => playerNavigate('games')} />
          ) : isPlayer && activeTab === 'deposit' ? (
            <PlayerDepositPage onBack={() => playerNavigate('games')} onOpenRequest={() => setIsTokenRequestOpen(true)} />
          ) : isPlayer && activeTab === 'withdrawal' ? (
            <PlayerWithdrawalPage onBack={() => playerNavigate('games')} />
          ) : (
            <MobileDashboard
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              activeGameCode={activeGameCode}
              setActiveGameCode={setActiveGameCode}
              onOpenTokenRequest={() => setIsTokenRequestOpen(true)}
              setPendingRequestsCount={setPendingRequestsCount}
            />
          )}
        </main>
        {!isPlayer && !activeGameCode && (
          <MobileBottomNav activeTab={activeTab} onSelectTab={(tab) => { setActiveGameCode(null); setActiveTab(tab); }} pendingRequestsCount={pendingRequestsCount} />
        )}
        <TokenRequestModal isOpen={isTokenRequestOpen} onClose={() => setIsTokenRequestOpen(false)} onRequestSubmitted={refreshWallet} />
      </div>
    </div>
  );
};

const AppShell: React.FC = () => <><ApiStatusBanner /><MainLayout /></>;

export function App() {
  return <AuthProvider><WebSocketProvider><AppShell /></WebSocketProvider></AuthProvider>;
}

export default App;
