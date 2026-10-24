import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function secretMatches(expected: string, supplied: string | null): boolean {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(expected) || !supplied) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(supplied);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const expected = Deno.env.get("AVIATOR_ENGINE_SECRET");
  const supplied = req.headers.get("x-aviator-engine-secret");
  if (!expected || !/^[A-Za-z0-9_-]{32,}$/.test(expected)) {
    return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  }
  if (!secretMatches(expected, supplied)) return json({ error: "UNAUTHORIZED" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Keep this below the scheduled invocation's 60-second timeout.
  const started = Date.now();
  const runForMs = 50_000;
  const tickLatenciesMs: number[] = [];
  const actionCounts: Record<string, number> = {};
  let lastAction: unknown = null;

  while (Date.now() - started < runForMs) {
    const tickStarted = Date.now();
    try {
      const { data, error } = await db.schema("aviator").rpc("tick_crash_engine");
      tickLatenciesMs.push(Date.now() - tickStarted);
      if (error) {
        console.error("Aviator engine RPC failed:", error.code ?? "unknown");
        return json({
          error: "ENGINE_TICK_FAILED",
          ticksCompleted: tickLatenciesMs.length - 1,
          tickLatencyMs: summarizeLatencies(tickLatenciesMs.slice(0, -1)),
        }, 503);
      }
      lastAction = data ?? { action: "no_result" };
      const action = typeof lastAction === "object" && lastAction !== null && "action" in lastAction
        ? String((lastAction as { action: unknown }).action)
        : "unknown";
      actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    } catch (error) {
      tickLatenciesMs.push(Date.now() - tickStarted);
      console.error("Aviator engine invocation failed:", error instanceof Error ? error.message : "unknown");
      return json({
        error: "ENGINE_TICK_FAILED",
        ticksCompleted: tickLatenciesMs.length - 1,
        tickLatencyMs: summarizeLatencies(tickLatenciesMs.slice(0, -1)),
      }, 503);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const elapsedMs = Date.now() - started;
  return json({
    ok: true,
    ticksCompleted: tickLatenciesMs.length,
    elapsedMs,
    tickIntervalTargetMs: 250,
    tickLatencyMs: summarizeLatencies(tickLatenciesMs),
    actionCounts,
    lastAction,
  });
});

function summarizeLatencies(samples: number[]) {
  if (samples.length === 0) return { count: 0, avg: null, p50: null, p95: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    count: samples.length,
    avg: Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 100) / 100,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
  };
}
