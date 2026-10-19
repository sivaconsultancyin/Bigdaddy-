import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import { User, TokenRequest, TokenRequestStatus, UserRole } from '../../../shared/src/types';
import { CreateUserModal } from '../components/common/CreateUserModal';
import { TokenRequestModal } from '../components/common/TokenRequestModal';
import { AdminPaymentSettingsCard } from '../components/common/AdminPaymentSettingsCard';
import { ProofScreenshotModal } from '../components/common/ProofScreenshotModal';
import {
  UserCheck,
  Users,
  Coins,
  UserPlus,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  RefreshCw,
  Camera,
  Image as ImageIcon,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const { wallet, refreshWallet } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<TokenRequest[]>([]);
  const [selectedProofRequest, setSelectedProofRequest] = useState<TokenRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Direct Transfer State
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferAmount, setTransferAmount] = useState('1000');
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
      const players = usersData.users.filter((u: User) => u.role === UserRole.PLAYER);
      if (players.length > 0 && !transferTargetId) {
        setTransferTargetId(players[0].id);
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
      setActionSuccess('Player token request approved & funded!');
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
      setActionSuccess('Player token request rejected.');
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
        note: 'Admin to Player funding',
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

  const myPlayers = users.filter((u) => u.role === UserRole.PLAYER);

  return (
    <div className="w-full px-3 py-3 space-y-3 pb-20">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-950/40 via-zinc-900 to-blue-950/30 border border-blue-500/30 rounded-2xl p-3.5 shadow-xl flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/40 shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-blue-200 font-serif leading-tight">
              Admin Agent Portal
            </h1>
            <p className="text-[10px] text-zinc-400">
              Manage your direct registered players
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
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
          <UserPlus className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span>+ Register Player</span>
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-2 text-center text-xs">
        <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
          <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">Float Balance</span>
          <span className="text-sm font-mono font-black text-amber-300 truncate block">
            {wallet ? parseInt(wallet.balance).toLocaleString() : '0'}
          </span>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
          <span className="text-[9px] text-zinc-500 uppercase font-bold block mb-0.5">My Players</span>
          <span className="text-sm font-mono font-black text-blue-300 block">
            {myPlayers.length}
          </span>
        </div>
      </div>

      {/* Admin Payment QR & UPI Configuration */}
      <AdminPaymentSettingsCard onUpdated={loadData} />

      {/* Pending Player Requests */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center gap-1.5 pb-2 border-b border-zinc-800 mb-2.5">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
            Player Requests ({requests.filter((r) => r.status === TokenRequestStatus.PENDING).length})
          </h3>
        </div>

        <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
          {requests.filter((r) => r.status === TokenRequestStatus.PENDING).length === 0 ? (
            <div className="text-center py-4 text-xs text-zinc-500">
              No pending requests from your players
            </div>
          ) : (
            requests
              .filter((r) => r.status === TokenRequestStatus.PENDING)
              .map((req) => (
                <div
                  key={req.id}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="truncate flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs text-zinc-200 block truncate">{req.requesterUsername}</span>
                      {req.proofScreenshot && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[8px] font-bold shrink-0">
                          Proof Attached
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-mono font-bold text-amber-300 block">
                      {parseInt(req.amount).toLocaleString()} Tokens
                    </span>
                    {req.note && (
                      <span className="text-[10px] text-zinc-400 block truncate font-mono">
                        UTR: {req.note}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {req.proofScreenshot && (
                      <button
                        type="button"
                        onClick={() => setSelectedProofRequest(req)}
                        className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 transition active:scale-95 shadow-sm"
                        title="View payment proof screenshot"
                      >
                        <Camera className="w-3 h-3 text-amber-400" />
                        <span>Screenshot</span>
                      </button>
                    )}
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

      {/* Direct Transfer to Player */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="pb-2 border-b border-zinc-800 mb-2 flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono">
            Direct Player Transfer
          </h3>
        </div>

        <form onSubmit={handleDirectTransfer} className="space-y-2.5">
          <div>
            <label className="text-[10px] font-semibold text-zinc-400 block mb-0.5">
              Select Player
            </label>
            <select
              value={transferTargetId}
              onChange={(e) => setTransferTargetId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none"
            >
              {myPlayers.map((u) => (
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
              min="10"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-zinc-100 text-xs font-mono focus:outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={transferLoading || !transferTargetId}
            className="w-full py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
          >
            {transferLoading ? 'Transferring...' : 'Send Tokens to Player'}
          </button>
        </form>
      </div>

      {/* My Players List */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
          <h3 className="font-bold text-xs text-zinc-200 uppercase font-mono flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-blue-400" />
            <span>Assigned Players ({myPlayers.length})</span>
          </h3>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="text-[10px] text-blue-400 font-bold underline"
          >
            + Register
          </button>
        </div>

        <div className="space-y-1.5">
          {myPlayers.map((pl: any) => (
            <div key={pl.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl px-2.5 py-2 flex items-center justify-between text-xs">
              <div>
                <span className="font-semibold text-zinc-200 block text-[11px]">{pl.username}</span>
                {pl.referralCode && (
                  <span className="text-[9px] text-amber-400 font-mono">Ref: {pl.referralCode}</span>
                )}
              </div>
              <span className="font-mono font-bold text-amber-300 text-xs">
                {pl.wallet ? parseInt(pl.wallet.balance).toLocaleString() : '0'} Chips
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
