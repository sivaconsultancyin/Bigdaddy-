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

function continueEngine(url: string, secret: string) {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (!runtime?.waitUntil) {
    console.error("Aviator engine continuation unavailable: EdgeRuntime.waitUntil missing");
    return false;
  }

  runtime.waitUntil((async () => {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/aviator-engine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aviator-engine-secret": secret,
          "x-aviator-engine-continuation": "1",
        },
        body: "{}",
      });
      if (!response.ok) {
        console.error("Aviator engine continuation rejected:", response.status);
      }
      await response.body?.cancel();
    } catch (error) {
      console.error("Aviator engine continuation request failed:", error instanceof Error ? error.message : "unknown");
    }
  })());
  return true;
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

  // Keep each invocation below the Edge Function timeout. The next invocation is
  // started before this one exits, so a minute-based cron is not needed.
  const started = Date.now();
  const runForMs = 49_000;
  const continueAfterMs = 47_500;
  let continuationScheduled = false;
  const tickLatenciesMs: number[] = [];
  const actionCounts: Record<string, number> = {};
  let lastAction: unknown = null;

  const ensureContinuation = () => {
    if (continuationScheduled) return;
    continuationScheduled = continueEngine(url, expected);
  };

  while (Date.now() - started < runForMs) {
    const tickStarted = Date.now();
    try {
      const { data, error } = await db.schema("aviator").rpc("tick_crash_engine");
      tickLatenciesMs.push(Date.now() - tickStarted);
      if (error) {
        console.error("Aviator engine RPC failed:", error.code ?? "unknown");
        ensureContinuation();
        return json({
          error: "ENGINE_TICK_FAILED",
          ticksCompleted: tickLatenciesMs.length - 1,
          tickLatencyMs: summarizeLatencies(tickLatenciesMs.slice(0, -1)),
          continuationScheduled,
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
      ensureContinuation();
      return json({
        error: "ENGINE_TICK_FAILED",
        ticksCompleted: tickLatenciesMs.length - 1,
        tickLatencyMs: summarizeLatencies(tickLatenciesMs.slice(0, -1)),
        continuationScheduled,
      }, 503);
    }

    if (!continuationScheduled && Date.now() - started >= continueAfterMs) {
      ensureContinuation();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Fallback in case an unusually slow tick prevented scheduling inside the loop.
  ensureContinuation();

  const elapsedMs = Date.now() - started;
  return json({
    ok: true,
    ticksCompleted: tickLatenciesMs.length,
    elapsedMs,
    tickIntervalTargetMs: 100,
    continuationScheduled,
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
