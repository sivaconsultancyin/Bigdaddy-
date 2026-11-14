import React from 'react';
import { ArrowLeft, AlertCircle, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Props { onBack: () => void; }

export const PlayerWithdrawalPage: React.FC<Props> = ({ onBack }) => {
  const { wallet } = useAuth();
  return (
    <div className="w-full min-w-0 px-3 py-4 pb-8 space-y-4 text-zinc-100">
      <button onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"><ArrowLeft className="h-4 w-4" /> Back to Games</button>
      <div><h1 className="text-xl font-bold text-amber-200">Withdrawal</h1><p className="mt-1 text-sm text-zinc-400">Withdrawal request status and available balance.</p></div>
      <section className="rounded-2xl border border-amber-500/30 bg-zinc-900/70 p-4"><div className="flex items-center gap-2 text-amber-200"><Wallet className="h-5 w-5" /><span className="font-semibold">Available Wallet Balance</span></div><p className="mt-2 text-2xl font-black tabular-nums text-amber-300">{Number(wallet?.balance || 0).toLocaleString()}</p></section>
      <section role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><h2 className="font-semibold text-amber-200">Withdrawal is not enabled yet</h2><p className="mt-2 text-sm leading-relaxed text-zinc-300">The current application API does not expose a secure withdrawal request, approval, or settlement endpoint. No request has been submitted and no balance has been changed. This page will be enabled after the server-side withdrawal workflow, payment verification, and audit trail are implemented.</p></div></div></section>
    </div>
  );
};
