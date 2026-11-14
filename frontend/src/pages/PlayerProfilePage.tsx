import React, { useEffect, useState } from 'react';
import { ArrowLeft, LogOut, UserRound, Wallet, Clock3, ShieldCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import { LedgerEntry } from '../../../shared/src/types';

interface Props { onBack: () => void; }

export const PlayerProfilePage: React.FC<Props> = ({ onBack }) => {
  const { user, wallet, logout, refreshWallet } = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ApiClient.getLedger();
      setEntries(Array.isArray(result?.entries) ? result.entries : []);
      await refreshWallet();
    } catch (err: any) {
      setError(err?.message || 'Could not load your transaction history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadHistory(); }, []);

  const balance = wallet?.balance ? BigInt(wallet.balance).toLocaleString() : '0';
  const created = user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—';

  return (
    <div className="w-full min-w-0 px-3 py-4 pb-8 space-y-4 text-zinc-100">
      <button onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"><ArrowLeft className="h-4 w-4" /> Back to Games</button>
      <section className="rounded-2xl border border-amber-500/30 bg-zinc-900/70 p-4">
        <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300"><UserRound className="h-6 w-6" /></div><div className="min-w-0"><h1 className="text-lg font-bold text-amber-200">My Profile</h1><p className="truncate text-sm text-zinc-400">{user?.username || 'Player'}</p></div></div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Info label="Player name" value={user?.username || '—'} />
          <Info label="Username" value={user?.username || '—'} />
          <Info label="Player ID" value={user?.id || '—'} />
          <Info label="Email" value={user?.email || '—'} />
          <Info label="Account role" value={user?.role || '—'} />
          <Info label="Registered" value={created} />
          <Info label="Account status" value="Authenticated" />
        </div>
      </section>
      <section className="rounded-2xl border border-amber-500/20 bg-zinc-900/70 p-4">
        <div className="flex items-center gap-2 text-amber-200"><Wallet className="h-5 w-5" /><h2 className="font-semibold">Wallet Balance</h2></div>
        <p className="mt-2 text-2xl font-black tabular-nums text-amber-300">{balance}</p>
      </section>
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-amber-300" /><h2 className="font-semibold">Transaction History</h2></div><button onClick={() => void loadHistory()} className="rounded-lg border border-zinc-700 p-2 text-zinc-300" aria-label="Refresh transaction history"><RefreshCw className="h-4 w-4" /></button></div>
        {loading ? <p className="py-5 text-center text-sm text-zinc-400">Loading your transactions…</p> : error ? <p role="alert" className="py-4 text-sm text-rose-300">{error}</p> : entries.length === 0 ? <p className="py-5 text-center text-sm text-zinc-500">No transactions yet.</p> : <div className="mt-3 space-y-2">{entries.map((entry) => <div key={entry.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-200">{entry.description}</p><p className="mt-1 text-xs text-zinc-500">{new Date(entry.timestamp).toLocaleString()}</p></div><span className={`shrink-0 text-sm font-bold tabular-nums ${entry.direction === 'CREDIT' ? 'text-emerald-300' : 'text-rose-300'}`}>{entry.direction === 'CREDIT' ? '+' : '−'}{Number(entry.amount).toLocaleString()}</span></div>)}</div>}
      </section>
      <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-semibold text-rose-300"><LogOut className="h-4 w-4" /> Logout</button>
    </div>
  );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-1 break-all text-sm text-zinc-200">{value}</p></div>;
