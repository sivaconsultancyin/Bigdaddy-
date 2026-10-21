import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, WifiOff } from 'lucide-react';
import { useWebSocket } from '../../context/WebSocketContext';

function formatCheckedAt(timestamp: number | null) {
  if (timestamp === null) return 'Waiting for first check';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const ApiStatusBanner: React.FC = () => {
  const { apiHealth, apiLastCheckedAt, apiResponseTimeMs } = useWebSocket();

  const state = {
    checking: {
      label: 'Checking API',
      detail: 'Testing live backend connectivity',
      className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
      Icon: Activity,
    },
    online: {
      label: 'API Online',
      detail: 'Backend reachable · Database connected',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      Icon: CheckCircle2,
    },
    degraded: {
      label: 'API Degraded',
      detail: 'Backend responds, but database or readiness checks are failing',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      Icon: AlertTriangle,
    },
    offline: {
      label: 'API Offline',
      detail: 'Backend health check timed out or could not connect',
      className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
      Icon: WifiOff,
    },
  }[apiHealth];

  const Icon = state.Icon;

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`w-full border-b px-3 py-1.5 text-[10px] sm:text-xs ${state.className}`}
      data-api-health={apiHealth}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="font-bold">{state.label}</span>
          <span className="hidden sm:inline opacity-80">— {state.detail}</span>
        </div>
        <div className="flex items-center gap-2 opacity-80">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {formatCheckedAt(apiLastCheckedAt)}
          </span>
          {apiResponseTimeMs !== null && <span>{apiResponseTimeMs} ms</span>}
          <span className="hidden md:inline">Auto-check: 10s</span>
        </div>
      </div>
    </aside>
  );
};
