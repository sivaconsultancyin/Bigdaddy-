import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock3 } from 'lucide-react';
import { ApiClient } from '../../api/client';

type Probe = { method: string; path: string; label: string; safe: boolean };
type Result = Probe & { status: 'online' | 'degraded' | 'offline' | 'manual'; code?: number; latencyMs?: number; checkedAt: string; error?: string };

const probes: Probe[] = [
  // Keep this inventory aligned with server.ts and the three mounted production routers.
  { method: 'GET', path: '/health', label: 'API liveness', safe: true },
  { method: 'GET', path: '/ready', label: 'API readiness / dependencies', safe: true },
  { method: 'GET', path: '/config', label: 'Public configuration', safe: true },
  { method: 'GET', path: '/auth/me', label: 'Current user', safe: true },
  { method: 'GET', path: '/auth/users', label: 'Descendant users', safe: true },
  { method: 'GET', path: '/wallet/my-wallet', label: 'Wallet balance', safe: true },
  { method: 'GET', path: '/wallet/summary', label: 'Treasury / wallet summary', safe: true },
  { method: 'GET', path: '/wallet/ledger', label: 'Wallet ledger', safe: true },
  { method: 'GET', path: '/requests/list', label: 'Token requests', safe: true },
  { method: 'GET', path: '/games/list', label: 'Games / pools list', safe: true },
  { method: 'GET', path: '/games/aviator/state', label: 'Aviator round state', safe: true },
  { method: 'GET', path: '/games/aviator/history', label: 'Aviator round history', safe: true },
  { method: 'GET', path: '/games/roulette/state', label: 'Roulette state', safe: true },
  { method: 'GET', path: '/games/dice/state', label: 'Dice state', safe: true },
  { method: 'GET', path: '/games/dragon-tiger/state', label: 'Dragon Tiger state', safe: true },
  { method: 'GET', path: '/games/andar-bahar/state', label: 'Andar Bahar state', safe: true },
  { method: 'POST', path: '/auth/login', label: 'Login', safe: false },
  { method: 'POST', path: '/auth/register-referral', label: 'Referral registration', safe: false },
  { method: 'POST', path: '/auth/create-user', label: 'Create user', safe: false },
  { method: 'POST', path: '/auth/bootstrap-owner', label: 'Owner bootstrap', safe: false },
  { method: 'POST', path: '/wallet/transfer', label: 'Wallet transfer', safe: false },
  { method: 'POST', path: '/wallet/game-pool', label: 'Game pool allocation', safe: false },
  { method: 'POST', path: '/requests/create', label: 'Create token request', safe: false },
  { method: 'POST', path: '/requests/:id/approve', label: 'Approve token request', safe: false },
  { method: 'POST', path: '/requests/:id/reject', label: 'Reject token request', safe: false },
  { method: 'POST', path: '/games/aviator/activate', label: 'Activate Aviator pool', safe: false },
  { method: 'POST', path: '/games/:gameCode/activate', label: 'Activate game pool', safe: false },
  { method: 'POST', path: '/games/aviator/bet', label: 'Aviator bet', safe: false },
  { method: 'POST', path: '/games/aviator/cashout', label: 'Aviator cashout', safe: false },
  { method: 'POST', path: '/games/roulette/bet', label: 'Roulette bet', safe: false },
  { method: 'POST', path: '/games/dice/bet', label: 'Dice bet', safe: false },
  { method: 'POST', path: '/games/dragon-tiger/bet', label: 'Dragon Tiger bet', safe: false },
  { method: 'POST', path: '/games/andar-bahar/bet', label: 'Andar Bahar bet', safe: false },
];

export const ApiHealthPanel: React.FC = () => {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const checkEndpoints = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const checkedAt = new Date().toISOString();
    const next = await Promise.all(probes.map(async (probe): Promise<Result> => {
      if (!probe.safe) return { ...probe, status: 'manual', checkedAt, error: 'Not called automatically: endpoint may change balances or game state.' };
      const started = performance.now();
      try {
        await ApiClient.request(probe.path, { method: 'GET' });
        return { ...probe, status: 'online', code: 200, latencyMs: Math.round(performance.now() - started), checkedAt };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const match = message.match(/(?:API request failed\s*\(|HTTP\s*)(\d{3})/i);
        const status = (error as { status?: unknown } | null)?.status;
        const code = typeof status === 'number' ? status : match ? Number(match[1]) : undefined;
        // Auth-required and role-restricted GETs prove the route answered; they do not prove its data dependency works.
        if (code === 401 || code === 403 || /AUTH_REQUIRED|INVALID_TOKEN|FORBIDDEN|INSUFFICIENT_PERMISSIONS|NOT_AUTHORIZED|OWNER_ONLY|PLAYER_ROLE_REQUIRED/i.test(message)) return { ...probe, status: 'online', code: code ?? (/AUTH_REQUIRED|INVALID_TOKEN/i.test(message) ? 401 : 403), latencyMs: Math.round(performance.now() - started), checkedAt, error: 'Route answered; this owner session is not authorized for that resource.' };
        if (code !== undefined && code >= 500) return { ...probe, status: 'degraded', code, latencyMs: Math.round(performance.now() - started), checkedAt, error: message };
        if (code !== undefined) return { ...probe, status: 'online', code, latencyMs: Math.round(performance.now() - started), checkedAt, error: `Route answered with HTTP ${code}; check the endpoint-level condition below.` };
        return { ...probe, status: 'offline', latencyMs: Math.round(performance.now() - started), checkedAt, error: message };
      }
    }));
    setResults(next);
    setLastChecked(checkedAt);
    runningRef.current = false;
    setRunning(false);
  }, []);

  useEffect(() => {
    void checkEndpoints();
    const timer = window.setInterval(() => { void checkEndpoints(); }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const online = results.filter(r => r.status === 'online').length;
  const degraded = results.filter(r => r.status === 'degraded').length;
  const offline = results.filter(r => r.status === 'offline').length;
  const manual = results.filter(r => r.status === 'manual').length;

  return (
    <section className="bg-zinc-950 border border-cyan-500/25 rounded-2xl p-3.5 shadow-xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <div>
            <h2 className="text-xs font-bold text-zinc-100 uppercase font-mono">API & System Health</h2>
            <p className="text-[10px] text-zinc-500">Endpoint reachability · auto-refresh 10s</p>
          </div>
        </div>
        <button onClick={() => { void checkEndpoints(); }} disabled={running} className="p-2 rounded-lg border border-zinc-700 text-zinc-300 disabled:opacity-50" aria-label="Refresh API health">
          <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2"><div className="text-lg font-black text-emerald-300">{online}</div><div className="text-[9px] uppercase text-zinc-400">Responding</div></div>
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2"><div className="text-lg font-black text-amber-300">{degraded}</div><div className="text-[9px] uppercase text-zinc-400">Dependency error</div></div>
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-2"><div className="text-lg font-black text-rose-300">{offline}</div><div className="text-[9px] uppercase text-zinc-400">No response</div></div>
        <div className="rounded-xl bg-zinc-500/10 border border-zinc-500/20 p-2"><div className="text-lg font-black text-zinc-300">{manual}</div><div className="text-[9px] uppercase text-zinc-400">Mutation skipped</div></div>
      </div>
      <p className="text-[10px] text-zinc-500 flex items-center gap-1"><Clock3 className="w-3 h-3" /> Last check: {lastChecked ? new Date(lastChecked).toLocaleTimeString() : 'Checking…'}</p>
      <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
        {results.map((r) => (
          <div key={r.method + r.path} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
            <div className="flex items-start gap-2">
              {r.status === 'online' ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" /> : r.status === 'offline' ? <XCircle className="w-3.5 h-3.5 mt-0.5 text-rose-400 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-200 font-semibold">{r.label}</span>
                  <span className={`text-[9px] font-bold uppercase ${r.status === 'online' ? 'text-emerald-400' : r.status === 'offline' ? 'text-rose-400' : 'text-amber-400'}`}>{r.status === 'online' ? 'Responding' : r.status === 'degraded' ? 'Degraded' : r.status === 'offline' ? 'No response' : 'Not probed'}</span>
                </div>
                <div className="mt-0.5 text-[9px] font-mono text-zinc-500 break-all">{r.method} {r.path}</div>
                <div className="mt-0.5 text-[9px] text-zinc-500">{r.code ? `HTTP ${r.code} · ` : ''}{r.latencyMs !== undefined ? `${r.latencyMs} ms` : ''}{r.error ? ` · ${r.error}` : ''}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">Route inventory is matched to the registered routes in server.ts, production.routes.ts, production.requests.routes.ts and authoritative-games.routes.ts. Read-only GET routes are probed. HTTP 5xx is shown as Degraded with the backend's returned reason; network/timeouts are No response. Financial/game-changing POST routes are deliberately skipped so monitoring never transfers funds, creates users, places bets, cashes out, or changes game state. “Responding” confirms an HTTP response, not successful business logic.</p>
    </section>
  );
};
