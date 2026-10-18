import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldCheck, X, Database, Key, Server, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { AppMode } from '../../../../shared/src/types';

interface ConfigStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConfigStatusModal: React.FC<ConfigStatusModalProps> = ({ isOpen, onClose }) => {
  const { configInfo } = useAuth();

  if (!isOpen) return null;

  const isPreview = configInfo?.mode !== AppMode.PRODUCTION;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3">
      <div className="bg-zinc-950 border border-amber-500/30 w-full max-w-[390px] rounded-2xl p-4 shadow-2xl relative text-zinc-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-900 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-amber-300 font-serif">Environment & System Mode</h3>
            <p className="text-xs text-zinc-400">
              BigDaddy Casino dual-mode operational architecture
            </p>
          </div>
        </div>

        {/* Current Active Mode */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400 uppercase font-semibold">Active Mode</span>
            <span
              className={`text-xs font-bold font-mono px-2.5 py-0.5 rounded-full border ${
                isPreview
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              }`}
            >
              {isPreview ? '● Development / Preview Mode' : '● Production Mode'}
            </span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            {isPreview
              ? 'Running in zero-credential preview mode. All balances, double-entry ledger transfers, bets, and crash results are simulated in-memory. No external PostgreSQL database or Supabase credentials required.'
              : 'Running in Production Mode connected to an authoritative database and verified cryptographic secrets.'}
          </p>
        </div>

        {/* Operational Checklist */}
        <div className="space-y-2.5 mb-6 text-xs">
          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-300">
              <Database className="w-4 h-4 text-amber-400" />
              <span>Database Engine:</span>
            </div>
            <span className="font-mono text-zinc-300 font-semibold">
              {isPreview ? 'Isolated In-Memory Authoritative Store' : 'PostgreSQL Database'}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-300">
              <Key className="w-4 h-4 text-emerald-400" />
              <span>Token Balances & Transactions:</span>
            </div>
            <span className="font-mono text-amber-400 font-bold">
              {isPreview ? 'Simulated Tokens (Demo Only)' : 'Real Authoritative Ledger'}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-300">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <span>Mandatory Production Env Vars:</span>
            </div>
            <span className="font-mono text-zinc-400">
              {isPreview ? 'Optional (Not Required)' : 'Enforced & Validated'}
            </span>
          </div>
        </div>

        {/* Deployment Notice */}
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-zinc-300 space-y-1.5 mb-6">
          <div className="flex items-center gap-1.5 font-bold text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Ready to Deploy to Production?</span>
          </div>
          <p className="leading-relaxed text-zinc-400">
            To switch to production, set <code className="text-amber-300 font-mono">APP_MODE=production</code> and configure
            your <code className="text-zinc-200 font-mono">DATABASE_URL</code>, <code className="text-zinc-200 font-mono">JWT_SECRET</code>, and <code className="text-zinc-200 font-mono">SESSION_SECRET</code>. Production mode fails safely if these are missing.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
