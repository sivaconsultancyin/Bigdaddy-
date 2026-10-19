import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import {
  GameInfo,
  LedgerEntry,
  TokenRequest,
  TokenRequestStatus,
  UserRole,
  User,
  TokenSupplyInfo,
  AuditLog,
} from '../../../shared/src/types';
import { TokenRequestModal } from '../components/common/TokenRequestModal';
import { CreateUserModal } from '../components/common/CreateUserModal';
import { AviatorGame } from '../games/aviator/AviatorGame';
import { RouletteGame } from '../games/roulette/RouletteGame';
import { RoulettePreview } from '../games/roulette/RoulettePreview';
import { TeenPattiGame } from '../games/teen-patti/TeenPattiGame';
import { DiceGame } from '../games/dice/DiceGame';
import { DicePreview } from '../games/dice/DicePreview';
import { DragonTigerGame } from '../games/dragon-tiger/DragonTigerGame';
import { DragonTigerPreview } from '../games/dragon-tiger/DragonTigerPreview';
import { AndarBaharGame } from '../games/andar-bahar/AndarBaharGame';
import { AndarBaharPreview } from '../games/andar-bahar/AndarBaharPreview';
import { MobileTab } from '../components/common/MobileBottomNav';
import { AdminPaymentSettingsCard } from '../components/common/AdminPaymentSettingsCard';
import { PlayerAdminPaymentCard } from '../components/common/PlayerAdminPaymentCard';
import {
  Gamepad2,
  Coins,
  User as UserIcon,
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
  LogOut,
  UserPlus,
  ShieldCheck,
  Send,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Activity,
  Crown,
  Shield,
  UserCheck,
} from 'lucide-react';

interface MobileDashboardProps {
  activeTab: MobileTab;
  setActiveTab: (tab: MobileTab) => void;
  activeGameCode: string | null;
  setActiveGameCode: (code: string | null) => void;
  onOpenTokenRequest: () => void;
  setPendingRequestsCount?: (count: number) => void;
}

export const MobileDashboard: React.FC<MobileDashboardProps> = ({
  activeTab,
  setActiveTab,
  activeGameCode,
  setActiveGameCode,
  onOpenTokenRequest,
  setPendingRequestsCount,
}) => {
  const { user, wallet, refreshWallet, logout, configInfo } = useAuth();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [requests, setRequests] = useState<TokenRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [supply, setSupply] = useState<TokenSupplyInfo | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Modals & Drawers
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Expandable Admin Controls
  const [expandedSection, setExpandedSection] = useState<'approvals' | 'transfer' | 'users' | null>(null);

  // Direct Transfer State
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferAmount, setTransferAmount] = useState('1000');
  const [transferLoading, setTransferLoading] = useState(false);

  const isOwner = user?.role === UserRole.OWNER;
  const isSuperAdmin = user?.role === UserRole.SUPER_ADMIN;
  const isAdmin = user?.role === UserRole.ADMIN;
  const hasStaffRole = isOwner || isSuperAdmin || isAdmin;
  const isPlayer = user?.role === UserRole.PLAYER;

  // Strict Role Guard: Owner, Super Admin, and Admin dashboards must NEVER display or access games
  useEffect(() => {
    if (!isPlayer) {
      if (activeGameCode) {
        setActiveGameCode(null);
      }
      if (activeTab === 'games') {
        setActiveTab('dashboard');
      }
    }
  }, [isPlayer, activeGameCode, activeTab, setActiveGameCode, setActiveTab]);

  const loadData = async () => {
    try {
      const promises: Promise<any>[] = [
        ApiClient.getLedger().catch(() => ({ entries: [] })),
        ApiClient.getTokenRequests().catch(() => ({ requests: [] })),
      ];

      // Games are STRICTLY loaded only for Player logins
      if (isPlayer) {
        promises.push(ApiClient.getGames().catch(() => ({ games: [] })));
      }

      const results = await Promise.all(promises);
      const ledgerData = results[0];
      const reqsData = results[1];
      const gamesData = isPlayer ? results[2] : null;

      if (gamesData?.games) setGames(gamesData.games);
      if (ledgerData.entries) setLedgerEntries(ledgerData.entries);
      if (reqsData.requests) {
        setRequests(reqsData.requests);
        const pending = reqsData.requests.filter(
          (r: TokenRequest) => r.status === TokenRequestStatus.PENDING
        ).length;
        if (setPendingRequestsCount) setPendingRequestsCount(pending);
      }

      if (hasStaffRole) {
        const [usersData, auditData] = await Promise.all([
          ApiClient.getUsers().catch(() => ({ users: [] })),
          ApiClient.getAuditLogs().catch(() => ({ logs: [] })),
        ]);
        if (usersData.users) {
          setUsers(usersData.users);
          if (!transferTargetId && usersData.users.length > 0) {
            setTransferTargetId(usersData.users[0].id);
          }
        }
        if (auditData.logs) setAuditLogs(auditData.logs);

        if (isOwner || isSuperAdmin) {
          const supp = await ApiClient.getSupplySummary().catch(() => null);
          if (supp) setSupply(supp);
        }
      }
    } catch (err) {
      console.error('Error loading mobile dashboard data', err);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.role, isPlayer]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshWallet();
    await loadData();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const handleCopyReferral = () => {
    if (user?.referralCode) {
      navigator.clipboard.writeText(user.referralCode);
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 2000);
    }
  };

  const handleApproveRequest = async (id: string) => {
    try {
      await ApiClient.approveTokenRequest(id);
      setActionNotice('Token request approved & settled.');
      await refreshWallet();
      await loadData();
      setTimeout(() => setActionNotice(null), 3000);
    } catch (err: any) {
      setActionNotice(err.message || 'Approval failed');
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  const handleRejectRequest = async (id: string) => {
    try {
      await ApiClient.rejectTokenRequest(id);
      setActionNotice('Token request rejected.');
      await loadData();
      setTimeout(() => setActionNotice(null), 3000);
    } catch (err: any) {
      setActionNotice(err.message || 'Rejection failed');
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  const handleDirectTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTargetId) return;
    setTransferLoading(true);
    try {
      await ApiClient.transferTokens({
        recipientId: transferTargetId,
        amount: transferAmount,
        note: `Direct mobile transfer from ${user?.username}`,
      });
      setActionNotice(`Transferred ${parseInt(transferAmount).toLocaleString()} tokens.`);
      await refreshWallet();
      await loadData();
      setExpandedSection(null);
      setTimeout(() => setActionNotice(null), 3000);
    } catch (err: any) {
      setActionNotice(err.message || 'Transfer failed');
      setTimeout(() => setActionNotice(null), 4000);
    } finally {
      setTransferLoading(false);
    }
  };

  const getGameIcon = (iconName: string) => {
    switch (iconName) {
      case 'Plane':
        return <Plane className="w-4 h-4 text-amber-400" />;
      case 'Disc':
        return <Disc className="w-4 h-4 text-rose-400" />;
      case 'Club':
        return <Club className="w-4 h-4 text-emerald-400" />;
      case 'Dice5':
        return <Dice5 className="w-4 h-4 text-blue-400" />;
      case 'Flame':
        return <Flame className="w-4 h-4 text-amber-500" />;
      case 'Layers':
      default:
        return <Layers className="w-4 h-4 text-purple-400" />;
    }
  };

  // If a game screen is active, render it exclusively for Player accounts
  if (isPlayer && activeGameCode) {
    if (activeGameCode === 'aviator') {
      return <AviatorGame onBackToLobby={() => setActiveGameCode(null)} />;
    }
    if (activeGameCode === 'roulette') {
      return <RouletteGame onBackToLobby={() => setActiveGameCode(null)} />;
    }
    if (activeGameCode === 'teen-patti') {
      return <TeenPattiGame onBackToLobby={() => setActiveGameCode(null)} />;
    }
    if (activeGameCode === 'andar-bahar') {
      return <AndarBaharGame onBackToLobby={() => setActiveGameCode(null)} />;
    }
    if (activeGameCode === 'dragon-tiger') {
      return <DragonTigerGame onBackToLobby={() => setActiveGameCode(null)} />;
    }
    if (activeGameCode === 'dice') {
      return <DiceGame onBackToLobby={() => setActiveGameCode(null)} />;
    }
  }

  // Games Card is STRICTLY for Player accounts only!
  const showGamesCard = isPlayer && (activeTab === 'dashboard' || activeTab === 'games');
  const showStaffOverviewCard = !isPlayer && activeTab === 'dashboard';
  const showWalletCard = activeTab === 'dashboard' || activeTab === 'wallet';
  const showProfileCard = activeTab === 'dashboard' || activeTab === 'profile';
  const crashGame = games.find((game) => game.code === 'aviator');
  const crashGameActive = crashGame?.status === 'ACTIVE';

  // Keep all six games visible when the API catalog is incomplete; this does not activate them.
  const playerGameCatalog: GameInfo[] = [
    { id: 'catalog-aviator', code: 'aviator', name: 'Aviator / Crash', status: 'COMING_SOON' as GameInfo['status'], poolWalletId: 'catalog-aviator-pool', poolBalance: '0', minBet: 10, maxBet: 100000, description: 'Crash game', iconName: 'Plane', route: '/games/aviator' },
    { id: 'catalog-roulette', code: 'roulette', name: 'European Roulette', status: 'COMING_SOON' as GameInfo['status'], poolWalletId: 'catalog-roulette-pool', poolBalance: '0', minBet: 10, maxBet: 100000, description: 'European roulette', iconName: 'Disc', route: '/games/roulette' },
    { id: 'catalog-teen-patti', code: 'teen-patti', name: 'Teen Patti', status: 'COMING_SOON' as GameInfo['status'], poolWalletId: 'catalog-teen-patti-pool', poolBalance: '0', minBet: 10, maxBet: 100000, description: 'Teen Patti card game', iconName: 'Club', route: '/games/teen-patti' },
    { id: 'catalog-dice', code: 'dice', name: 'Dice', status: 'COMING_SOON' as GameInfo['status'], poolWalletId: 'catalog-dice-pool', poolBalance: '0', minBet: 10, maxBet: 100000, description: 'Dice game', iconName: 'Dice5', route: '/games/dice' },
    { id: 'catalog-dragon-tiger', code: 'dragon-tiger', name: 'Dragon Tiger', status: 'COMING_SOON' as GameInfo['status'], poolWalletId: 'catalog-dragon-tiger-pool', poolBalance: '0', minBet: 10, maxBet: 100000, description: 'Dragon Tiger card game', iconName: 'Flame', route: '/games/dragon-tiger' },
    { id: 'catalog-andar-bahar', code: 'andar-bahar', name: 'Andar Bahar', status: 'COMING_SOON' as GameInfo['status'], poolWalletId: 'catalog-andar-bahar-pool', poolBalance: '0', minBet: 10, maxBet: 100000, description: 'Andar Bahar card game', iconName: 'Layers', route: '/games/andar-bahar' },
  ];
  const gamesForDisplay = playerGameCatalog.map((catalogGame) => {
    const apiGame = games.find((game) => game.code === catalogGame.code);
    return apiGame ? { ...catalogGame, ...apiGame } : catalogGame;
  });

  const pendingRequests = requests.filter((r) => r.status === TokenRequestStatus.PENDING);

  return (
    <div className="w-full px-3 py-2.5 space-y-3 pb-24 text-zinc-100">
      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* =========================================================================
          STAFF ONLY: ADMINISTRATIVE & TREASURY OVERVIEW (NO GAMES!)
          ========================================================================= */}
      {showStaffOverviewCard && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3.5 shadow-xl relative overflow-hidden transition-all space-y-3">
          {/* Staff Authority Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/80">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-md ${
                  isOwner
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-amber-500/20'
                    : isSuperAdmin
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-purple-500/20'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-blue-500/20'
                }`}
              >
                {isOwner ? (
                  <Crown className="w-5 h-5 text-amber-400" />
                ) : isSuperAdmin ? (
                  <Shield className="w-5 h-5 text-purple-400" />
                ) : (
                  <UserCheck className="w-5 h-5 text-blue-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 leading-tight">
                  <h2 className="text-xs font-black text-amber-200 font-serif uppercase tracking-wider">
                    {isOwner
                      ? 'Owner Authority Console'
                      : isSuperAdmin
                      ? 'Super Admin Operations'
                      : 'Admin Agent Console'}
                  </h2>
                </div>
                <span className="text-[10px] text-zinc-400 font-medium">
                  {isOwner
                    ? 'Master Treasury & Reserve Governance'
                    : isSuperAdmin
                    ? 'Regional Allocation & Admin Supervision'
                    : 'Player Onboarding & Request Approvals'}
                </span>
              </div>
            </div>

            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                isOwner
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : isSuperAdmin
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
              }`}
            >
              {user?.role}
            </span>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5">
              <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">
                {isOwner ? 'Treasury Balance' : 'Wallet Balance'}
              </span>
              <span className="text-base font-black font-mono text-amber-300 tracking-tight">
                {parseInt(wallet?.balance || '0').toLocaleString()} tokens
              </span>
            </div>

            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5">
              <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">
                Pending Requests
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-base font-black font-mono tracking-tight ${
                    pendingRequests.length > 0 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
                  }`}
                >
                  {pendingRequests.length}
                </span>
                {pendingRequests.length > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    Action Needed
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Token Supply Metrics (for Owner & Super Admin) */}
          {(isOwner || isSuperAdmin) && supply && (
            <div className="bg-gradient-to-r from-amber-950/30 via-zinc-900/90 to-zinc-950 border border-amber-500/30 rounded-xl p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-amber-300 uppercase flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  <span>Total Token Supply</span>
                </span>
                <span className="text-[9px] font-mono font-bold text-emerald-400">
                  {parseInt(supply.maxSupply || '10000000000').toLocaleString()} tokens max
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                  <span className="text-zinc-500 text-[8px] uppercase block">Circulating</span>
                  <span className="text-zinc-200 font-bold">
                    {parseInt(supply.circulating || '0').toLocaleString()}
                  </span>
                </div>
                <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                  <span className="text-zinc-500 text-[8px] uppercase block">In Treasury</span>
                  <span className="text-amber-400 font-bold">
                    {parseInt(supply.treasuryBalance || '0').toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Quick Administrative Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Sub-Account</span>
            </button>

            <button
              onClick={() =>
                setExpandedSection(expandedSection === 'transfer' ? null : 'transfer')
              }
              className="py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold text-xs transition active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5 text-amber-400" />
              <span>Direct Transfer</span>
            </button>
          </div>

          {/* Admin Payment QR & UPI Configuration Section */}
          {isAdmin && (
            <div className="pt-2 border-t border-zinc-800/80">
              <AdminPaymentSettingsCard onUpdated={loadData} />
            </div>
          )}
        </section>
      )}

      {/* =========================================================================
          CARD 1: GAMES CARD (PLAYERS ONLY!)
          ========================================================================= */}
      {showGamesCard && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3 shadow-xl relative overflow-hidden transition-all">
          {/* Card Header */}
          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-sm">
                <Gamepad2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-black text-amber-200 font-serif uppercase tracking-wider leading-none">
                  Games
                </h2>
                <span className="text-[9px] text-zinc-500 font-medium">Authoritative Casino Suite</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                {gamesForDisplay.filter((g) => g.status === 'ACTIVE').length} LIVE
              </span>
            </div>
          </div>

          {/* Featured Hero Game: Crash Game */}
          <div className="bg-gradient-to-br from-amber-950/40 via-zinc-900 to-zinc-950 border border-amber-500/40 rounded-xl p-3 mb-2.5 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 via-rose-600 to-amber-600 flex items-center justify-center text-white shadow-md shadow-red-500/20 shrink-0">
                  <Plane className="w-5 h-5 text-white animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-zinc-100 leading-tight">Aviator / Crash</span>
                    <span className={crashGameActive ? "text-[8px] font-black px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 uppercase" : "text-[8px] font-black px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase"}>
                      {crashGameActive ? '● LIVE' : 'COMING SOON'}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 block leading-tight mt-0.5">
                    Authoritative curve · Instant cashout
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono bg-zinc-950/80 rounded-lg px-2.5 py-1.5 border border-zinc-800/80 mb-2.5">
              <span className="text-zinc-400">Min: {crashGame?.minBet || '10'} Tokens</span>
              <span className="text-amber-400 font-bold">Max: {Number(crashGame?.maxBet || 100000).toLocaleString()}</span>
              <span className="text-emerald-400 font-bold">RTP 97%</span>
            </div>

            <button
              onClick={() => setActiveGameCode('aviator')}
              className="w-full py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
            >
              <span>{crashGameActive ? 'Play Crash Now' : 'Open Crash Preview'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Upcoming Games Grid (Compact mobile 2-col cards) */}
          <div className="grid grid-cols-2 gap-2">
            {gamesForDisplay
              .filter((g) => g.code !== 'aviator')
              .map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGameCode(g.code)}
                  className="bg-zinc-900/70 border border-zinc-800 hover:border-amber-500/30 rounded-xl p-2 text-left transition flex flex-col justify-between active:scale-[0.98] group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700/50">
                      {getGameIcon(g.iconName)}
                    </div>
                    <span
                      className={`text-[8px] uppercase font-bold px-1.5 py-0.2 rounded ${
                        g.status === 'ACTIVE'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {g.status === 'ACTIVE' ? '● LIVE' : 'Preview'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block truncate leading-tight group-hover:text-amber-300">
                      {g.name}
                    </span>
                    <span className="text-[9px] text-zinc-500 font-mono block mt-0.5">
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
      {showWalletCard && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3 shadow-xl relative overflow-hidden transition-all">
          {/* Card Header */}
          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-sm">
                <Coins className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-black text-amber-200 font-serif uppercase tracking-wider leading-none">
                  Wallet
                </h2>
                <span className="text-[9px] text-zinc-500 font-medium">Double-Entry Ledger</span>
              </div>
            </div>
            <button
              onClick={handleManualRefresh}
              className="p-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-amber-400 transition"
              title="Refresh wallet balance"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>

          {/* Balance Display */}
          <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-900/60 rounded-xl p-3 border border-zinc-800 mb-2.5">
            <div className="flex items-center justify-between text-[9px] text-zinc-400 uppercase font-semibold mb-1">
              <span>{isOwner ? 'Treasury Reserve' : 'Available Balance'}</span>
              <span className="text-[8px] font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                {configInfo?.isSimulated ? 'SIMULATED TOKENS' : 'PERSISTENT TOKENS'}
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-amber-300 tracking-tight flex items-center gap-1.5 mb-1">
              <Coins className="w-5 h-5 text-amber-400 shrink-0" />
              <span>{wallet ? parseInt(wallet.balance).toLocaleString() : '0'}</span>
            </div>
            <span className="text-[10px] text-zinc-500 block leading-tight">
              {isOwner
                ? 'Genesis 10 Billion max supply authority'
                : configInfo?.isSimulated
                ? 'Isolated preview balance; simulated only.'
                : 'Stored in PostgreSQL with a double-entry ledger.'}
            </span>
          </div>

          {/* PLAYER ONLY: Admin Deposit UPI & QR Code Photo Card */}
          {isPlayer && (
            <div className="mb-3">
              <PlayerAdminPaymentCard onRequestTokens={() => setIsRequestModalOpen(true)} />
            </div>
          )}

          {/* ADMIN ONLY: Admin Payment QR & UPI Configuration */}
          {isAdmin && (
            <div className="mb-3">
              <AdminPaymentSettingsCard onUpdated={loadData} />
            </div>
          )}

          {/* Primary Action Button */}
          {!isOwner ? (
            <button
              onClick={() => setIsRequestModalOpen(true)}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-sm transition active:scale-[0.98] mb-2.5 flex items-center justify-center gap-1.5"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Request Additional Chips</span>
            </button>
          ) : (
            <div className="mb-2.5">
              <button
                onClick={() =>
                  setExpandedSection(expandedSection === 'transfer' ? null : 'transfer')
                }
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-sm transition active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5 text-zinc-950" />
                <span>Direct Transfer</span>
              </button>
            </div>
          )}

          {/* Pending Approvals Drawer for Staff Roles */}
          {hasStaffRole && pendingRequests.length > 0 && (
            <div className="mb-2.5 bg-amber-950/20 border border-amber-500/30 rounded-xl p-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-amber-300 uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Pending Requests ({pendingRequests.length})</span>
                </span>
                <span className="text-[9px] text-zinc-500">Requires Approval</span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-2 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="truncate">
                      <div className="font-bold text-zinc-200 truncate">{req.requesterUsername}</div>
                      <div className="text-[10px] text-amber-400 font-mono font-bold">
                        +{parseInt(req.amount).toLocaleString()} tokens
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleApproveRequest(req.id)}
                        className="p-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                        title="Approve"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRejectRequest(req.id)}
                        className="p-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
                        title="Reject"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Direct Transfer Form Drawer */}
          {expandedSection === 'transfer' && (
            <form onSubmit={handleDirectTransfer} className="mb-2.5 p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
              <span className="text-[10px] font-bold text-amber-300 uppercase block">Direct Transfer</span>
              <div>
                <label className="text-[9px] text-zinc-400 uppercase block mb-0.5">Recipient</label>
                <select
                  value={transferTargetId}
                  onChange={(e) => setTransferTargetId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-zinc-400 uppercase block mb-0.5">Amount</label>
                <input
                  type="number"
                  min="1"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 font-mono"
                />
              </div>
              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setExpandedSection(null)}
                  className="px-2.5 py-1 text-xs text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferLoading}
                  className="px-3 py-1 bg-amber-500 text-zinc-950 font-bold text-xs rounded-lg"
                >
                  {transferLoading ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          )}

          {/* Recent Ledger History */}
          <div className="pt-2 border-t border-zinc-900">
            <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 mb-1.5">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Recent Ledger Entries</span>
              </div>
              <span className="text-[9px] text-zinc-500 font-mono">Immutable Log</span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
              {ledgerEntries.length === 0 ? (
                <div className="text-center py-3 text-[10px] text-zinc-500">
                  No transaction history recorded yet
                </div>
              ) : (
                ledgerEntries.slice(0, 5).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-[10px]"
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
      {showProfileCard && (
        <section className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3 shadow-xl relative overflow-hidden transition-all">
          {/* Card Header */}
          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-sm">
                <UserIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-black text-amber-200 font-serif uppercase tracking-wider leading-none">
                  Profile
                </h2>
                <span className="text-[9px] text-zinc-500 font-medium">Identity & Permissions</span>
              </div>
            </div>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
              {user?.role}
            </span>
          </div>

          {/* Account Details */}
          <div className="space-y-1.5 mb-2.5 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-400 text-[11px]">Username:</span>
              <span className="font-bold text-zinc-100">{user?.username}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-400 text-[11px]">Role Authority:</span>
              <span className="font-mono font-bold text-amber-400">{user?.role}</span>
            </div>
          </div>

          {/* Referral Code Share Widget */}
          <div className="bg-gradient-to-r from-amber-950/30 to-zinc-900 p-2.5 rounded-xl border border-amber-500/20 mb-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 text-[11px] text-amber-300 font-bold">
                <Share2 className="w-3.5 h-3.5" />
                <span>My Referral Code</span>
              </div>
              <span className="text-[9px] text-zinc-500">Player Registration</span>
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

          {/* Staff Sub-Accounts / Team Management Drawer */}
          {hasStaffRole && (
            <div className="mb-2.5 p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-zinc-300 uppercase flex items-center gap-1">
                  <UserPlus className="w-3 h-3 text-amber-400" />
                  <span>Sub-Account Hierarchy</span>
                </span>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-zinc-950 transition hover:bg-amber-400"
                >
                  + Add User
                </button>
              </div>

              <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                {users.length === 0 ? (
                  <div className="text-[10px] text-zinc-500 text-center py-1">No subordinate accounts</div>
                ) : (
                  users.slice(0, 4).map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-1.5 rounded-md bg-zinc-950/60 border border-zinc-800/80 text-[10px]"
                    >
                      <span className="font-semibold text-zinc-300 truncate">{u.username}</span>
                      <span className="text-[9px] font-mono text-zinc-500 px-1 rounded bg-zinc-900 border border-zinc-800">
                        {u.role}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Sign Out Button */}
          <button
            onClick={logout}
            className="w-full py-2 rounded-xl text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </section>
      )}

      {/* =========================================================================
          GLOBAL MODALS (Mobile Constrained)
          ========================================================================= */}
      <TokenRequestModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        onRequestSubmitted={handleManualRefresh}
      />

      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onUserCreated={loadData}
      />
    </div>
  );
};
