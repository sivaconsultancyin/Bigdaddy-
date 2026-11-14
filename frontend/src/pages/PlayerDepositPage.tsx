import React, { useEffect, useState } from 'react';
import { ArrowLeft, Wallet, Clock3, ArrowDownToLine } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import { PlayerAdminPaymentCard } from '../components/common/PlayerAdminPaymentCard';
import { TokenRequest } from '../../../shared/src/types';

interface Props { onBack: () => void; onOpenRequest: () => void; }

export const PlayerDepositPage: React.FC<Props> = ({ onBack, onOpenRequest }) => {
  const { wallet, user } = useAuth();
  const [requests, setRequests] = useState<TokenRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ApiClient.getTokenRequests()
      .then((result) => setRequests((result?.requests || []).filter((item: TokenRequest) => item.requesterId === user?.id)))
      .catch((err: any) => setError(err?.message || 'Could not load deposit requests.'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  return (
    <div className="w-full min-w-0 px-3 py-4 pb-8 space-y-4 text-zinc-100">
      <button onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"><ArrowLeft className="h-4 w-4" /> Back to Games</button>
      <div><h1 className="text-xl font-bold text-amber-200">Deposit</h1><p className="mt-1 text-sm text-zinc-400">Submit a payment proof for admin verification.</p></div>
      <section className="rounded-2xl border border-amber-500/30 bg-zinc-900/70 p-4"><div className="flex items-center gap-2 text-amber-200"><Wallet className="h-5 w-5" /><span className="font-semibold">Current Wallet Balance</span></div><p className="mt-2 text-2xl font-black tabular-nums text-amber-300">{Number(wallet?.balance || 0).toLocaleString()}</p></section>
      <PlayerAdminPaymentCard onRequestTokens={onOpenRequest} />
      <button onClick={onOpenRequest} className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 font-bold text-zinc-950"><ArrowDownToLine className="h-4 w-4" /> Submit Deposit Request</button>
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-amber-300" /><h2 className="font-semibold">Deposit Request History</h2></div>
        {loading ? <p className="py-4 text-sm text-zinc-400">Loading requests…</p> : error ? <p role="alert" className="py-4 text-sm text-rose-300">{error}</p> : requests.length === 0 ? <p className="py-4 text-sm text-zinc-500">No deposit requests yet.</p> : <div className="mt-3 space-y-2">{requests.map((request) => <div key={request.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"><div className="min-w-0"><p className="text-sm font-semibold text-zinc-200">{Number(request.amount).toLocaleString()} tokens</p><p className="text-xs text-zinc-500">{new Date(request.createdAt).toLocaleString()}</p></div><span className="shrink-0 rounded-full border border-zinc-700 px-2 py-1 text-[10px] font-bold text-amber-200">{request.status}</span></div>)}</div>}
      </section>
    </div>
  );
};
