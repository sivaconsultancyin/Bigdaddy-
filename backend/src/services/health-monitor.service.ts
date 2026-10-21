import { randomUUID } from 'node:crypto';
import { getDatabaseClient, isDatabaseConnected } from '../db/postgres';

export type HealthFailure = {
  id: string;
  occurredAt: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  component: string;
  reasonCode: string;
  reason: string;
  recovery: string;
};

const MAX_MEMORY_EVENTS = 250;
const recentEvents: HealthFailure[] = [];

function safeText(value: unknown, max = 240): string {
  const text = typeof value === 'string' ? value : '';
  return text
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s"'<>]+/gi, '[database-url-redacted]')
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max);
}

function classify(path: string, statusCode: number, reasonCode: string): { component: string; reason: string; recovery: string } {
  if (/wallet|transfer|ledger/i.test(path)) {
    return { component: 'Wallet API', reason: reasonCode || 'Wallet request failed; inspect database query and wallet transaction logs.', recovery: 'Check database connectivity, wallet schema permissions, query timeout and transaction rollback. Retry only after confirming idempotency.' };
  }
  if (/auth|login|register/i.test(path) || statusCode === 401) {
    return { component: 'Authentication', reason: reasonCode || 'Authentication request failed.', recovery: 'Check credentials/session validity, auth database pool, account lookup and server-side auth logs. Never log passwords or tokens.' };
  }
  if (/games|aviator|bet|cashout|round|settle/i.test(path)) {
    return { component: 'Game / Settlement', reason: reasonCode || 'Game request failed.', recovery: 'Check round state, worker health, database locks, pending settlement and idempotency before retrying financial actions.' };
  }
  if (/ready|health|monitoring/i.test(path)) {
    return { component: 'Backend / Readiness', reason: reasonCode || 'Health/readiness check failed.', recovery: 'Check backend process, production configuration and database connectivity.' };
  }
  return { component: 'Backend API / Database', reason: reasonCode || 'Request failed or timed out.', recovery: 'Inspect the matching request ID in Render logs, then check database connectivity, query/lock timeouts and pool saturation.' };
}

export function recordHealthFailure(input: Omit<HealthFailure, 'id' | 'occurredAt' | 'component' | 'reason' | 'recovery'> & { reasonCode?: string; reason?: string }): void {
  const classified = classify(input.path, input.statusCode, safeText(input.reasonCode || input.reason || ''));
  const event: HealthFailure = {
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    requestId: safeText(input.requestId, 80),
    method: safeText(input.method, 12),
    path: safeText(input.path, 180),
    statusCode: input.statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    component: classified.component,
    reasonCode: safeText(input.reasonCode || 'REQUEST_FAILED', 80),
    reason: safeText(input.reason || classified.reason),
    recovery: classified.recovery,
  };

  recentEvents.unshift(event);
  if (recentEvents.length > MAX_MEMORY_EVENTS) recentEvents.length = MAX_MEMORY_EVENTS;
  // Render logs remain a fallback if PostgreSQL itself is unavailable.
  console.error('[health-failure]', JSON.stringify(event));

  if (isDatabaseConnected()) {
    void (async () => {
      try {
        const sql = getDatabaseClient();
        await sql`
          insert into platform.system_health_events
            (id, occurred_at, request_id, method, path, status_code, duration_ms, component, reason_code, reason, recovery)
          values
            (${event.id}::uuid, ${event.occurredAt}::timestamptz, ${event.requestId}, ${event.method},
             ${event.path}, ${event.statusCode}, ${event.durationMs}, ${event.component},
             ${event.reasonCode}, ${event.reason}, ${event.recovery})
        `;
      } catch (error) {
        // Do not recurse through the monitor when the monitor table/database fails.
        console.error('[health-failure-persist-failed]', error instanceof Error ? safeText(error.message) : 'unknown database error');
      }
    })();
  }
}

export async function getRecentHealthFailures(limit = 100): Promise<{ events: HealthFailure[]; persistence: 'database' | 'memory-fallback' }> {
  const boundedLimit = Math.min(250, Math.max(1, Math.floor(limit)));
  if (isDatabaseConnected()) {
    try {
      const sql = getDatabaseClient();
      const rows = await sql`
        select id::text, occurred_at, request_id, method, path, status_code, duration_ms,
               component, reason_code, reason, recovery
        from platform.system_health_events
        order by occurred_at desc
        limit ${boundedLimit}
      `;
      const persisted = rows.map((row: any) => ({
        id: String(row.id),
        occurredAt: new Date(row.occurred_at).toISOString(),
        requestId: String(row.request_id),
        method: String(row.method),
        path: String(row.path),
        statusCode: Number(row.status_code),
        durationMs: Number(row.duration_ms),
        component: String(row.component),
        reasonCode: String(row.reason_code),
        reason: String(row.reason),
        recovery: String(row.recovery),
      }));
      const byId = new Map<string, HealthFailure>();
      for (const event of [...recentEvents.slice(0, boundedLimit), ...persisted]) byId.set(event.id, event);
      return { events: [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, boundedLimit), persistence: 'database' };
    } catch (error) {
      console.error('[health-failure-read-fallback]', error instanceof Error ? safeText(error.message) : 'unknown database error');
    }
  }
  return { events: recentEvents.slice(0, boundedLimit), persistence: 'memory-fallback' };
}
