import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import { User, TokenRequest, TokenRequestStatus, UserRole } from '../../../shared/src/types';
import { CreateUserModal } from '../components/common/CreateUserModal';
import { TokenRequestModal } from '../components/common/TokenRequestModal';
import {
  Shield,
  Users,
  Coins,
  UserPlus,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  RefreshCw,
} from 'lucide-react';

export const SuperAdminDashboard: React.FC = () => {
  const { wallet, refreshWallet } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<TokenRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Direct Transfer State
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferAmount, setTransferAmount] = useState('50000');
  const [transferLoading, setTransferLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, reqsData] = await Promise.all([
        ApiClient.getUsers(),
        ApiClient.getTokenRequests(),
      ]);
      setUsers(usersData.users);
      setRequests(reqsData.requests);
      const admins = usersData.users.filter((u: User) => u.role === UserRole.ADMIN);
      if (admins.length > 0 && !transferTargetId) {
        setTransferTargetId(admins[0].id);
      }
    } catch (err) {
      console.error(err);
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
      setActionSuccess('Token request approved & funded!');
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
      setActionSuccess('Token request rejected.');
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
        note: 'SuperAdmin to Admin allocation',
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

  const myAdmins = users.filter((u) => u.role === UserRole.ADMIN);
  const myPlayers = users.filter((u) => u.role === UserRole.PLAYER);

  return (
    <div className="w-full px-3 py-3 space-y-3 pb-20">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-purple-950/40 via-zinc-900 to-purple-950/30 border border-purple-500/30 rounded-2xl p-3.5 shadow-xl flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center border border-purple-500/40 shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-purple-200 font-serif leading-tight">
              Super Admin Branch
            </h1>
            <p className="text-[10px] text-zinc-400">
              Direct hierarchy agent oversight
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-purple-400' : ''}`} />
        </button>
      </div>

      {actionSuccess && (
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setIsRequestModalOpen(true)}
          className="py-2.5 px-2 rounded-xl font-bold text-[11px] bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-sm transition active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Coins className="w-3.5 h-3.5 shrink-0" />
          <span>Request Tokens</span>
        </button>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="py-2.5 px-2 rounded-xl font-bold text-[11px] bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span>+ Create Admin</span>
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
          <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Balance</span>
          <span className="text-xs font-mono font-black text-amber-300 truncate block">
            {wallet ? parseInt(wallet.balance).toLocaleString() : '0'}
          </span>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
          <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Admins</span>
          <span className="text-xs font-mono font-black text-purple-300 block">
            {myAdmins.length}
          </span>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
          <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Players</span>
          <span className="text-xs font-mono font-black text-emerald-300 block">
            {myPlayers.length}
          </span>
        </div>
      </div>

      {/* Admin Token Requests */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center gap-1.5 pb-2 border-b border-zinc-800 mb-2.5">
          <Clock className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
            Admin Requests ({requests.filter((r) => r.status === TokenRequestStatus.PENDING).length})
          </h3>
        </div>

        <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
          {requests.filter((r) => r.status === TokenRequestStatus.PENDING).length === 0 ? (
            <div className="text-center py-4 text-xs text-zinc-500">
              No pending requests from Admins
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
                    <span className="font-bold text-xs text-zinc-200 block truncate">{req.requesterUsername}</span>
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

      {/* Direct Transfer to Admin */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="pb-2 border-b border-zinc-800 mb-2 flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
            Fund Subordinate Admin
          </h3>
        </div>

        <form onSubmit={handleDirectTransfer} className="space-y-2.5">
          <div>
            <label className="text-[10px] font-semibold text-zinc-400 block mb-0.5">
              Select Admin
            </label>
            <select
              value={transferTargetId}
              onChange={(e) => setTransferTargetId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none"
            >
              {myAdmins.map((u) => (
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
              min="100"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-zinc-100 text-xs font-mono focus:outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={transferLoading || !transferTargetId}
            className="w-full py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
          >
            {transferLoading ? 'Transferring...' : 'Send Tokens to Admin'}
          </button>
        </form>
      </div>

      {/* Admin List */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span>My Admins ({myAdmins.length})</span>
          </h3>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="text-[10px] text-purple-400 font-bold underline"
          >
            + Create
          </button>
        </div>

        <div className="space-y-1.5">
          {myAdmins.map((adm: any) => (
            <div key={adm.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl px-2.5 py-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-200">{adm.username}</span>
              <span className="font-mono font-bold text-amber-300">
                {adm.wallet ? parseInt(adm.wallet.balance).toLocaleString() : '0'} Chips
              </span>
            </div>
          ))}
        </div>
      </div>

      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onUserCreated={loadData}
      />
      <TokenRequestModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        onRequestSubmitted={loadData}
      />
    </div>
  );
};
