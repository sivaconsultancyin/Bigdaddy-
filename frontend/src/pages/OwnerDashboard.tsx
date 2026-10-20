import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import {
  TokenSupplyInfo,
  User,
  TokenRequest,
  TokenRequestStatus,
  AuditLog,
  UserRole,
  GameInfo,
} from '../../../shared/src/types';
import { CreateUserModal } from '../components/common/CreateUserModal';
import { AllocatePoolModal } from '../components/common/AllocatePoolModal';
import {
  Crown,
  Coins,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Clock,
  UserPlus,
  RefreshCw,
  Activity,
  Send,
} from 'lucide-react';

export const OwnerDashboard: React.FC = () => {
  const { refreshWallet } = useAuth();
  const [supply, setSupply] = useState<TokenSupplyInfo | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<TokenRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAllocateModalOpen, setIsAllocateModalOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Direct Transfer State
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferAmount, setTransferAmount] = useState('100000');
  const [transferLoading, setTransferLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [suppData, usersData, reqsData, auditData, gamesData] = await Promise.all([
        ApiClient.getSupplySummary(),
        ApiClient.getUsers(),
        ApiClient.getTokenRequests(),
        ApiClient.getAuditLogs().catch(() => ({ logs: [] })),
        ApiClient.getGames(),
      ]);

      setSupply(suppData);
      setUsers(usersData.users);
      setRequests(reqsData.requests);
      setAuditLogs(auditData.logs);
      if (gamesData.games) setGames(gamesData.games);
      if (usersData.users.length > 0 && !transferTargetId) {
        setTransferTargetId(usersData.users[0].id);
      }
    } catch (err) {
      console.error('Failed to load owner dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      await ApiClient.approveTokenRequest(id);
      setActionSuccess('Request approved & tokens transferred.');
      loadData();
      refreshWallet();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await ApiClient.rejectTokenRequest(id);
      setActionSuccess('Request rejected without balance change.');
      loadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(err.message);
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
        note: 'Direct Treasury allocation from Owner',
      });
      setActionSuccess(`Transferred ${parseInt(transferAmount).toLocaleString()} tokens!`);
      loadData();
      refreshWallet();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTransferLoading(false);
    }
  };

  return (
    <div className="w-full px-3 py-3 space-y-3 pb-20">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-amber-950/40 via-zinc-900 to-amber-950/30 border border-amber-500/30 rounded-2xl p-3.5 shadow-xl flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40 shrink-0">
            <Crown className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-amber-200 font-serif leading-tight">
              Owner Master Treasury
            </h1>
            <p className="text-[10px] text-zinc-400">
              Double-entry token authority & Game Pools
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
        </button>
      </div>

      {actionSuccess && (
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="py-2.5 px-2 rounded-xl font-bold text-[11px] bg-gradient-to-r from-amber-500 to-yellow-600 text-zinc-950 shadow-sm transition active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5 shrink-0" />
          <span>+ Add Super Admin</span>
        </button>
        <button
          onClick={() => {
            const transferSec = document.getElementById('direct-transfer-form');
            transferSec?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="py-2.5 px-2 rounded-xl font-bold text-[11px] bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Transfer Tokens</span>
        </button>
      </div>

      {/* 10 Billion Fixed Token Supply Invariant Card */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold text-zinc-200 uppercase font-mono">
              10B Token Invariant
            </h2>
          </div>
          <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.2 rounded-full border border-emerald-500/20">
            100% Balanced
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">
              Treasury
            </span>
            <span className="text-sm font-mono font-black text-amber-300 block truncate">
              {supply ? parseInt(supply.treasuryBalance).toLocaleString() : '...'}
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">
              Game Pools
            </span>
            <span className="text-sm font-mono font-black text-yellow-400 block truncate">
              {supply ? parseInt(supply.gamePoolsBalance).toLocaleString() : '...'}
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">
              Role Wallets
            </span>
            <span className="text-sm font-mono font-black text-purple-400 block truncate">
              {supply ? parseInt(supply.roleWalletsBalance).toLocaleString() : '...'}
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">
              Bet Escrow
            </span>
            <span className="text-sm font-mono font-black text-blue-400 block truncate">
              {supply ? parseInt(supply.escrowBalance).toLocaleString() : '...'}
            </span>
          </div>
        </div>
      </div>

      {/* Game Pools Liquidity Overview (Owner Dashboard: Game pools visibility & allocation) */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
          <div className="flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
              Game Pools Reserves ({games.length})
            </h3>
          </div>
          <button
            onClick={() => setIsAllocateModalOpen(true)}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 transition active:scale-95 flex items-center gap-1 shadow-sm"
          >
            <Coins className="w-3 h-3 text-zinc-950" />
            <span>+ Allocate Pool</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {games.map((g) => (
            <div
              key={g.id}
              className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2.5 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-zinc-200 truncate">{g.name}</span>
                <span className="text-[8px] font-mono px-1 rounded bg-emerald-500/20 text-emerald-400">
                  {g.status}
                </span>
              </div>
              <div className="text-[11px] font-mono font-black text-amber-300">
                ₹{parseInt(g.poolBalance || '0').toLocaleString()}
              </div>
              <div className="flex items-center justify-between mt-1 pt-1 border-t border-zinc-800/60 text-[9px] text-zinc-500 font-mono">
                <span>Min: {g.minBet}</span>
                <button
                  onClick={() => setIsAllocateModalOpen(true)}
                  className="text-amber-400 hover:underline font-bold"
                >
                  Transfer &gt;
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Requests */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center gap-1.5 pb-2 border-b border-zinc-800 mb-2.5">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
            Pending Token Requests ({requests.filter((r) => r.status === TokenRequestStatus.PENDING).length})
          </h3>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
          {requests.filter((r) => r.status === TokenRequestStatus.PENDING).length === 0 ? (
            <div className="text-center py-4 text-xs text-zinc-500">
              No pending requests
            </div>
          ) : (
            requests
              .filter((r) => r.status === TokenRequestStatus.PENDING)
              .map((req) => (
                <div
                  key={req.id}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="truncate">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-xs text-zinc-200 truncate">{req.requesterUsername}</span>
                      <span className="text-[8px] font-bold px-1 rounded bg-purple-500/20 text-purple-300">
                        {req.requesterRole}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-amber-300 block">
                      {parseInt(req.amount).toLocaleString()} Tokens
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      className="px-2 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Direct Transfer to Super Admin */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="pb-2 border-b border-zinc-800 mb-2 flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
            Treasury Transfer
          </h3>
        </div>

        <form onSubmit={handleDirectTransfer} className="space-y-2.5">
          <div>
            <label className="text-[10px] font-semibold text-zinc-400 block mb-0.5">
              Super Admin Recipient
            </label>
            <select
              value={transferTargetId}
              onChange={(e) => setTransferTargetId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none"
            >
              {users
                .filter((u) => u.role === UserRole.SUPER_ADMIN)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-zinc-400 block mb-0.5">
              Amount (Tokens)
            </label>
            <input
              type="number"
              min="1000"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-zinc-100 text-xs font-mono focus:outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={transferLoading || !transferTargetId}
            className="w-full py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-500 to-yellow-600 text-zinc-950 shadow-sm transition active:scale-[0.98] disabled:opacity-50"
          >
            {transferLoading ? 'Transferring...' : 'Send Tokens'}
          </button>
        </form>
      </div>

      {/* System Audit Logs */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
              System Audit Trail
            </h3>
          </div>
          <span className="text-[9px] text-zinc-500 font-mono">Immutable Log</span>
        </div>

        <div className="space-y-1.5 max-h-36 overflow-y-auto scrollbar-thin pr-0.5">
          {auditLogs.slice(0, 10).map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between px-2 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-[10px]"
            >
              <div className="flex items-center gap-1.5 truncate mr-2">
                <span className="font-mono text-[8px] px-1 rounded bg-zinc-800 text-amber-400">
                  {log.action}
                </span>
                <span className="text-zinc-300 truncate">{log.actorUsername}</span>
              </div>
              <span className="text-zinc-500 font-mono text-[9px] shrink-0">
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onUserCreated={loadData}
      />
      <AllocatePoolModal
        isOpen={isAllocateModalOpen}
        games={games}
        onClose={() => setIsAllocateModalOpen(false)}
        onAllocated={loadData}
      />
    </div>
  );
};
