import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock3 } from 'lucide-react';
import { ApiClient } from '../../api/client';

type Probe = { method: string; path: string; label: string; safe: boolean; validationOnly?: boolean };
type Result = Probe & { status: 'online' | 'degraded' | 'offline' | 'manual'; code?: number; latencyMs?: number; checkedAt: string; error?: string };
type FailureEvent = { id: string; occurredAt: string; requestId: string; method: string; path: string; statusCode: number; durationMs: number; component: string; reasonCode: string; reason: string; recovery: string };
type FailureResponse = { events: FailureEvent[]; persistence: 'database' | 'memory-fallback'; note: string };

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
  { method: 'POST', path: '/auth/login', label: 'Login', safe: true, validationOnly: true },
  { method: 'POST', path: '/auth/register-referral', label: 'Referral registration', safe: true, validationOnly: true },
  { method: 'POST', path: '/auth/create-user', label: 'Create user', safe: true, validationOnly: true },
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
  const [failures, setFailures] = useState<FailureEvent[]>([]);
  const [failurePersistence, setFailurePersistence] = useState<'database' | 'memory-fallback' | 'unavailable'>('unavailable');
  const [failureNote, setFailureNote] = useState<string>('Loading failure history…');
  type AviatorDiagnostic = {
    requestId: string; path: string; sentAt?: string; receivedAt?: string; outcome?: string;
    httpStatus?: number | null; latencyMs?: number | null; backendDurationMs?: number | null;
    backendReceivedAt?: string | null; backendCompletedAt?: string | null; pollingGapMs?: number | null;
    multiplier?: number | null; previousMultiplier?: number | null; multiplierUpdateGapMs?: number | null;
    roundStatus?: string | null; roundId?: string | null; realtimeConnected?: boolean; error?: string;
  };
  const [aviatorDiagnostics, setAviatorDiagnostics] = useState<AviatorDiagnostic[]>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('bigdaddy_aviator_diagnostics_v1') || '[]');
      return Array.isArray(stored) ? stored.filter((entry: AviatorDiagnostic) => entry?.path === '/games/aviator/state').slice(0, 40) : [];
    } catch { return []; }
  });
  useEffect(() => {
    const onDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<AviatorDiagnostic>).detail;
      if (!detail || detail.path !== '/games/aviator/state') return;
      setAviatorDiagnostics(previous => [detail, ...previous].slice(0, 40));
    };
    window.addEventListener('bigdaddy:aviator-diagnostic', onDiagnostic);
    return () => window.removeEventListener('bigdaddy:aviator-diagnostic', onDiagnostic);
  }, []);

  const loadFailures = useCallback(async () => {
    try {
      const response = await ApiClient.request<FailureResponse>('/monitoring/failures?limit=100');
      setFailures(response.events || []);
      setFailurePersistence(response.persistence);
      setFailureNote(response.note);
    } catch (error) {
      setFailurePersistence('unavailable');
      setFailureNote(error instanceof Error ? error.message : 'Could not load failure history. Check Owner authorization and API/database connectivity.');
    }
  }, []);

  const checkEndpoints = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const checkedAt = new Date().toISOString();
    const next = await Promise.all(probes.map(async (probe): Promise<Result> => {
      if (!probe.safe) return { ...probe, status: 'manual', checkedAt, error: 'Skipped for safety: this endpoint can change data, balances, or game state.' };
      const started = performance.now();
      try {
        // For selected POST routes, send JSON null: Zod object schemas reject it before database access or mutations.
        // Never send credentials, referral codes, usernames, or valid mutation payloads from a health check.
        await ApiClient.request(probe.path, probe.validationOnly
          ? { method: 'POST', body: JSON.stringify(null) }
          : { method: 'GET' });
        return { ...probe, status: 'online', code: 200, latencyMs: Math.round(performance.now() - started), checkedAt };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const match = message.match(/(?:API request failed\s*\(|HTTP\s*)(\d{3})/i);
        const status = (error as { status?: unknown } | null)?.status;
        const code = typeof status === 'number' ? status : match ? Number(match[1]) : undefined;
        // A validation-only POST is expected to fail input validation (400/422); this proves the handler answered without performing a mutation.
        if (probe.validationOnly && (code === 400 || code === 422)) return { ...probe, status: 'online', code, latencyMs: Math.round(performance.now() - started), checkedAt, error: 'Safe validation probe passed: invalid JSON value was rejected before mutation.' };
        // Auth-required and role-restricted routes prove the route answered; they do not prove all business dependencies are healthy.
        if (code === 401 || code === 403 || /AUTH_REQUIRED|INVALID_TOKEN|FORBIDDEN|INSUFFICIENT_PERMISSIONS|NOT_AUTHORIZED|OWNER_ONLY|PLAYER_ROLE_REQUIRED/i.test(message)) return { ...probe, status: 'online', code: code ?? (/AUTH_REQUIRED|INVALID_TOKEN/i.test(message) ? 401 : 403), latencyMs: Math.round(performance.now() - started), checkedAt, error: 'Route answered; this session is not authorized for that resource.' };
        if (code !== undefined && code >= 500) return { ...probe, status: 'degraded', code, latencyMs: Math.round(performance.now() - started), checkedAt, error: message };
        if (probe.validationOnly && code !== undefined && code >= 200 && code < 300) return { ...probe, status: 'degraded', code, latencyMs: Math.round(performance.now() - started), checkedAt, error: 'Unexpected success for invalid validation probe; verify handler validation before trusting this health result.' };
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
    void loadFailures();
    const timer = window.setInterval(() => { void checkEndpoints(); void loadFailures(); }, 10000);
    return () => window.clearInterval(timer);
  }, [checkEndpoints, loadFailures]);

  const online = results.filter(r => r.status === 'online').length;
  const degraded = results.filter(r => r.status === 'degraded').length;
  const offline = results.filter(r => r.status === 'offline').length;
  const manual = results.filter(r => r.status === 'manual').length;

  return (
    <section className="bg-zinc-950 border border-cyan-500/25 rounded-2xl p-3.5 shadow-xl space-y-3">
      <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-cyan-200">Aviator request diagnostics</h3>
          <span className="text-[10px] text-zinc-400">Recent {aviatorDiagnostics.length}/40</span>
        </div>
        <p className="text-[10px] text-zinc-400">Live device diagnostics. Backend timing appears only when the deployed Edge Function exposes timing headers. No event can mean the game poll is inactive or this build is old.</p>
        {aviatorDiagnostics.length === 0 ? (
          <p className="text-[11px] text-amber-300">No Aviator diagnostic events yet. Open Aviator in this app session, then return here and refresh the panel.</p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {aviatorDiagnostics.map((d, i) => (
              <article key={d.requestId + i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 space-y-1">
                <div className="flex flex-wrap justify-between gap-1">
                  <span className={`text-[10px] font-bold ${d.outcome === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>{d.outcome === 'success' ? 'Response received' : d.error || 'Request error'} {d.httpStatus ? `· HTTP ${d.httpStatus}` : ''}</span>
                  <span className="text-[9px] text-zinc-500">{d.receivedAt ? new Date(d.receivedAt).toLocaleTimeString() : 'No response timestamp'}</span>
                </div>
                <p className="text-[9px] font-mono text-zinc-400 break-all">Request ID: {d.requestId}</p>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-zinc-300">
                  <span>Frontend sent: {d.sentAt ? new Date(d.sentAt).toLocaleTimeString() : 'not recorded'}</span>
                  <span>Frontend total: {d.latencyMs == null ? 'unavailable' : `${d.latencyMs} ms`}</span>
                  <span>Backend received: {d.backendReceivedAt ? new Date(d.backendReceivedAt).toLocaleTimeString() : 'header unavailable'}</span>
                  <span>Backend completed: {d.backendCompletedAt ? new Date(d.backendCompletedAt).toLocaleTimeString() : 'header unavailable'}</span>
                  <span>Backend duration: {d.backendDurationMs == null ? 'unavailable' : `${d.backendDurationMs} ms`}</span>
                  <span>Polling gap: {d.pollingGapMs == null ? 'first request' : `${d.pollingGapMs} ms`}</span>
                  <span>Multiplier: {d.multiplier == null ? 'not returned' : `${d.multiplier.toFixed(2)}x`}</span>
                  <span>Multiplier update gap: {d.multiplierUpdateGapMs == null ? 'not measured' : `${d.multiplierUpdateGapMs} ms`}</span>
                  <span>Round: {d.roundStatus || 'unknown'}</span>
                  <span>Realtime: {d.realtimeConnected == null ? 'unknown' : d.realtimeConnected ? 'connected' : 'disconnected'}</span>
                </div>
                {d.backendDurationMs == null && <p className="text-[10px] text-amber-300">Backend timing unavailable: old deployment, CORS/proxy stripping, or no Edge response.</p>}
              </article>
            ))}
          </div>
        )}
      </div>
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
      <div className="rounded-xl border border-rose-500/25 bg-zinc-900/70 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-100">Failure details · recent 100</h3>
          <button onClick={() => { void loadFailures(); }} className="text-[10px] rounded-md border border-zinc-700 px-2 py-1 text-zinc-300">Refresh failures</button>
        </div>
        <p className="text-[10px] text-zinc-400">{failurePersistence === 'database' ? 'Persisted in database' : failurePersistence === 'memory-fallback' ? 'Memory fallback — recent process events only' : 'Failure history unavailable'} · {failureNote}</p>
        {failures.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No recorded failures in the available history.</p>
        ) : (
          <div className="space-y-2 max-h-[520px] overflow-y-auto">
            {failures.map((event) => (
              <article key={event.id} className="rounded-lg border border-rose-500/20 bg-zinc-950 p-2.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-rose-300">{event.component} · HTTP {event.statusCode}</span>
                  <span className="text-[9px] text-zinc-500">{new Date(event.occurredAt).toLocaleString()}</span>
                </div>
                <p className="text-[10px] font-mono text-zinc-300 break-all">{event.method} {event.path}</p>
                <p className="text-[10px] text-zinc-300"><strong>Reason:</strong> {event.reasonCode} — {event.reason}</p>
                <p className="text-[10px] text-zinc-400"><strong>Where/Duration:</strong> {event.durationMs} ms · Request ID: {event.requestId}</p>
                <p className="text-[10px] text-cyan-300"><strong>Next steps:</strong> {event.recovery}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">Route inventory is matched to registered backend routes. Read-only GET routes are probed normally. Login, referral registration, and create-user use a validation-only POST with JSON null; expected 400/422 confirms input validation rejected it before mutation. No credentials or valid mutation payloads are sent. All other financial/game-changing POST routes remain skipped. HTTP 5xx shows the backend reason; network/timeouts show No response. “Responding” confirms an HTTP response, not successful business logic.</p>
    </section>
  );
};
