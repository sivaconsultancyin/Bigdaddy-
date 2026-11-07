import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function secretMatches(expected: string, supplied: string | null): boolean {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(expected) || !supplied) return false;
  const a = new TextEncoder().encode(expected), b = new TextEncoder().encode(supplied);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function scheduleContinuation(url: string, secret: string) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (!runtime?.waitUntil) return false;
  runtime.waitUntil((async () => {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/aviator-engine`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-aviator-engine-secret": secret, "x-aviator-engine-continuation": "1" },
        body: "{}",
      });
      if (!response.ok) console.error("Aviator continuation rejected:", response.status);
      await response.body?.cancel();
    } catch (error) {
      console.error("Aviator continuation failed:", error instanceof Error ? error.message : "unknown");
    }
  })());
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const expected = Deno.env.get("AVIATOR_ENGINE_SECRET");
  if (!expected || !/^[A-Za-z0-9_-]{32,}$/.test(expected)) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  if (!secretMatches(expected, req.headers.get("x-aviator-engine-secret"))) return json({ error: "UNAUTHORIZED" }, 401);

  const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const workerId = crypto.randomUUID();
  const started = Date.now();
  const leaseMs = 15_000;
  let leaseAcquired = false;
  let continuationScheduled = false;
  let heartbeatTimer: number | null = null;
  const tickLatenciesMs: number[] = [];
  const actionCounts: Record<string, number> = {};
  let lastAction: unknown = null;

  // Cron and continuation may race. Only the holder of the database lease may tick.
  // A continuation waits briefly for the previous owner to release/expire its lease.
  for (let attempt = 0; attempt < 48 && !leaseAcquired; attempt++) {
    const { data, error } = await db.schema("aviator").rpc("acquire_engine_worker_lease", {
      p_worker_id: workerId, p_lease_seconds: 15,
    });
    if (error) {
      console.error("Aviator worker lease acquisition failed:", error.code ?? "unknown");
      return json({ error: "ENGINE_LEASE_UNAVAILABLE" }, 503);
    }
    leaseAcquired = data === true;
    if (!leaseAcquired) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!leaseAcquired) return json({ ok: true, skipped: true, reason: "ACTIVE_WORKER_LEASE_HELD" }, 202);

  let leaseLost = false;
  heartbeatTimer = setInterval(async () => {
    try {
      const { data, error } = await db.schema("aviator").rpc("heartbeat_engine_worker_lease", {
        p_worker_id: workerId, p_lease_seconds: 15,
      });
      if (error || data !== true) {
        leaseLost = true;
        console.error("Aviator worker lease heartbeat lost.");
      }
    } catch {
      leaseLost = true;
      console.error("Aviator worker lease heartbeat failed.");
    }
  }, 5_000) as unknown as number;

  const runForMs = 44_000;
  const continueAfterMs = 41_000;
  try {
    while (Date.now() - started < runForMs && !leaseLost) {
      const tickStarted = Date.now();
      const { data, error } = await db.schema("aviator").rpc("tick_crash_engine");
      tickLatenciesMs.push(Date.now() - tickStarted);
      if (error) {
        console.error("Aviator engine RPC failed:", error.code ?? "unknown");
        return json({ error: "ENGINE_TICK_FAILED", ticksCompleted: tickLatenciesMs.length - 1 }, 503);
      }
      lastAction = data ?? { action: "no_result" };
      const action = typeof lastAction === "object" && lastAction !== null && "action" in lastAction
        ? String((lastAction as { action: unknown }).action) : "unknown";
      actionCounts[action] = (actionCounts[action] ?? 0) + 1;

      if (!continuationScheduled && Date.now() - started >= continueAfterMs) {
        continuationScheduled = scheduleContinuation(url, expected);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    // Owner-checked release: a stale worker cannot release a successor's lease.
    const { error } = await db.schema("aviator").rpc("release_engine_worker_lease", { p_worker_id: workerId });
    if (error) console.error("Aviator worker lease release failed:", error.code ?? "unknown");
  }

  return json({
    ok: !leaseLost, ticksCompleted: tickLatenciesMs.length, elapsedMs: Date.now() - started,
    tickIntervalTargetMs: 100, continuationScheduled, workerLease: "released",
    tickLatencyMs: summarizeLatencies(tickLatenciesMs), actionCounts, lastAction,
  }, leaseLost ? 503 : 200);
});

function summarizeLatencies(samples: number[]) {
  if (!samples.length) return { count: 0, avg: null, p50: null, p95: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    count: samples.length,
    avg: Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length * 100) / 100,
    p50: percentile(0.5), p95: percentile(0.95), max: sorted[sorted.length - 1],
  };
}
