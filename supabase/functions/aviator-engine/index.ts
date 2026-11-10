import { createClient } from "npm:@supabase/supabase-js@2";
import { retryTimedOutTick } from "./retry.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function scheduleContinuation(url: string, secret: string, handoffToken: string) {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (!runtime?.waitUntil) return false;

  runtime.waitUntil((async () => {
    try {
      const response = await fetch(
        `${url.replace(/\/$/, "")}/functions/v1/aviator-engine`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-aviator-engine-secret": secret,
            "x-aviator-engine-handoff-token": handoffToken,
          },
          body: "{}",
        },
      );
      if (!response.ok) {
        console.error("Aviator continuation rejected:", response.status);
      }
      await response.body?.cancel();
    } catch (error) {
      console.error(
        "Aviator continuation request failed:",
        error instanceof Error ? error.message : "unknown",
      );
    }
  })());
  return true;
}

function summarizeLatencies(samples: number[]) {
  if (samples.length === 0) {
    return { count: 0, avg: null, p50: null, p95: null, max: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    count: samples.length,
    avg: Math.round(
      (samples.reduce((sum, value) => sum + value, 0) / samples.length) * 100,
    ) / 100,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const expected = Deno.env.get("AVIATOR_ENGINE_SECRET");
  const supplied = req.headers.get("x-aviator-engine-secret");
  if (!expected || !/^[A-Za-z0-9_-]{32,}$/.test(expected)) {
    return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  }
  if (!secretMatches(expected, supplied)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const workerId = crypto.randomUUID();
  const handoffToken = req.headers.get("x-aviator-engine-handoff-token");
  const leaseArgs = { p_ttl_seconds: 45 };

  const leaseResult = handoffToken
    ? await db.schema("aviator").rpc("consume_crash_engine_handoff", {
        p_handoff_token: handoffToken,
        p_new_owner_token: workerId,
        ...leaseArgs,
      })
    : await db.schema("aviator").rpc("claim_crash_engine_lease", {
        p_owner_token: workerId,
        ...leaseArgs,
      });

  if (leaseResult.error) {
    console.error("Aviator lease acquisition failed:", leaseResult.error.code ?? "unknown");
    return json({ error: "ENGINE_LEASE_UNAVAILABLE" }, 503);
  }
  if (leaseResult.data !== true) {
    return json({ ok: true, action: "worker_already_active" }, 202);
  }

  const started = Date.now();
  const runForMs = 42_000;
  const heartbeatEveryMs = 5_000;
  let nextHeartbeatAt = started + heartbeatEveryMs;
  const tickLatenciesMs: number[] = [];
  const actionCounts: Record<string, number> = {};
  let totalTickRetries = 0;
  let lastAction: unknown = null;
  let diceTickFailures = 0;
  let lastDiceAction: unknown = null;

  while (Date.now() - started < runForMs) {
    const tickStarted = Date.now();
    const tickAttempt = await retryTimedOutTick(() =>
      db.schema("aviator").rpc("tick_crash_engine_with_broadcast"),
    );
    const { data, error } = tickAttempt.result;
    totalTickRetries += tickAttempt.retries;
    tickLatenciesMs.push(Date.now() - tickStarted);
    if (tickAttempt.retries > 0) {
      console.warn("Aviator tick statement timeout recovered", {
        retries: tickAttempt.retries,
        attempts: tickAttempt.attempts,
        elapsedMs: Date.now() - tickStarted,
      });
    }

    if (error) {
      console.error("Aviator engine RPC failed:", error.code ?? "unknown");
      await db.schema("aviator").rpc("release_crash_engine_lease", {
        p_owner_token: workerId,
      });
      return json({
        error: "ENGINE_TICK_FAILED",
        ticksCompleted: tickLatenciesMs.length - 1,
        tickLatencyMs: summarizeLatencies(tickLatenciesMs.slice(0, -1)),
        tickRetries: totalTickRetries,
        diceTickFailures,
        lastDiceAction,
      }, 503);
    }

    lastAction = data ?? { action: "no_result" };
    const action =
      typeof lastAction === "object" && lastAction !== null && "action" in lastAction
        ? String((lastAction as { action: unknown }).action)
        : "unknown";
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;

    // The existing leased worker also advances Dice, but only after the catalog
    // marks it ACTIVE. This avoids calling a not-yet-migrated RPC while Dice is
    // COMING_SOON. Dice failures remain isolated from the Aviator engine.
    const diceConfig = await db.schema("platform").from("games")
      .select("status").eq("code", "dice").maybeSingle();
    if (diceConfig.error) {
      diceTickFailures += 1;
      console.error("Dice game config read failed:", diceConfig.error.code ?? "unknown");
    } else if (diceConfig.data?.status === "ACTIVE") {
      const diceTick = await db.schema("dice").rpc("advance_round");
      if (diceTick.error) {
        diceTickFailures += 1;
        console.error("Dice engine RPC failed:", diceTick.error.code ?? "unknown");
      } else {
        lastDiceAction = diceTick.data ?? null;
      }
    }

    if (Date.now() >= nextHeartbeatAt) {
      const heartbeat = await db.schema("aviator").rpc(
        "heartbeat_crash_engine_lease",
        { p_owner_token: workerId, ...leaseArgs },
      );
      if (heartbeat.error || heartbeat.data !== true) {
        console.error("Aviator engine lease lost; stopping worker");
        return json({
          error: "ENGINE_LEASE_LOST",
          ticksCompleted: tickLatenciesMs.length,
          tickLatencyMs: summarizeLatencies(tickLatenciesMs),
        }, 409);
      }
      nextHeartbeatAt = Date.now() + heartbeatEveryMs;
    }

    const delayMs =
      action === "round_running" ? 250 :
      action === "round_started" ? 150 :
      action === "waiting" || action === "round_created" ? 500 :
      action === "settled_recovery" ? 250 :
      action === "cooldown" || action === "busy" ? 1_000 :
      750;

    await sleep(delayMs);
  }

  const nextHandoffToken = crypto.randomUUID();
  const handoff = await db.schema("aviator").rpc(
    "handoff_crash_engine_lease",
    {
      p_owner_token: workerId,
      p_handoff_token: nextHandoffToken,
      p_ttl_seconds: 60,
    },
  );

  if (handoff.error || handoff.data !== true) {
    await db.schema("aviator").rpc("release_crash_engine_lease", {
      p_owner_token: workerId,
    });
    return json({
      error: "ENGINE_HANDOFF_FAILED",
      ticksCompleted: tickLatenciesMs.length,
      tickLatencyMs: summarizeLatencies(tickLatenciesMs),
      actionCounts,
      tickRetries: totalTickRetries,
    }, 503);
  }

  const continuationScheduled = scheduleContinuation(url, expected, nextHandoffToken);
  if (!continuationScheduled) {
    // The lease expires automatically if the EdgeRuntime continuation facility is unavailable.
    return json({
      ok: true,
      warning: "CONTINUATION_UNAVAILABLE_LEASE_WILL_EXPIRE",
      ticksCompleted: tickLatenciesMs.length,
      tickLatencyMs: summarizeLatencies(tickLatenciesMs),
      actionCounts,
      diceTickFailures,
      lastDiceAction,
    }, 200);
  }

  return json({
    ok: true,
    ticksCompleted: tickLatenciesMs.length,
    elapsedMs: Date.now() - started,
    tickIntervalMs: { running: 250, waiting: 500, idle: 1000 },
    continuationScheduled: true,
    tickLatencyMs: summarizeLatencies(tickLatenciesMs),
    actionCounts,
    tickRetries: totalTickRetries,
    lastAction,
    diceTickFailures,
    lastDiceAction,
  });
});
