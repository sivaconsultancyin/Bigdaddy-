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

// The handler runs its worker for 42s before responding. Keep this request alive
// long enough for the normal worker cycle, while remaining below the 60s handoff TTL.
const continuationFetchTimeoutMs = 55_000;

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

function scheduleContinuation(
  url: string,
  secret: string,
  handoffToken: string,
  releaseHandoff: () => PromiseLike<{ data: boolean | null; error: { message: string } | null }>,
  workerId: string,
  generation: number | null,
) {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (!runtime?.waitUntil) return false;

  runtime.waitUntil((async () => {
    const endpoint = `${url.replace(/\/$/, "")}/functions/v1/aviator-engine`;
    let lastFailure = "unknown";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const attemptStartedAt = Date.now();
      const attemptId = crypto.randomUUID();
      console.info(JSON.stringify({
        event: "aviator_continuation_attempt_started",
        workerId, generation, attempt, attemptId,
        at: new Date().toISOString(),
      }));
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-aviator-engine-secret": secret,
            "x-aviator-engine-handoff-token": handoffToken,
            "x-aviator-continuation-attempt-id": attemptId,
          },
          body: "{}",
          signal: AbortSignal.timeout(continuationFetchTimeoutMs),
        });
        await response.body?.cancel();
        if (response.ok) {
          console.info(JSON.stringify({
            event: "aviator_continuation_accepted",
            workerId, generation, attempt, status: response.status,
            elapsedMs: Date.now() - attemptStartedAt,
            at: new Date().toISOString(),
          }));
          return;
        }
        lastFailure = `http_${response.status}`;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : "unknown";
        const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
        const causeRecord = typeof cause === "object" && cause !== null
          ? cause as { name?: unknown; code?: unknown }
          : null;
        console.error(JSON.stringify({
          event: "aviator_continuation_fetch_error",
          workerId, generation, attempt, attemptId,
          errorName: error instanceof Error ? error.name : "unknown",
          reason: lastFailure,
          causeName: typeof causeRecord?.name === "string" ? causeRecord.name : null,
          causeCode: typeof causeRecord?.code === "string" ? causeRecord.code : null,
          elapsedMs: Date.now() - attemptStartedAt,
          at: new Date().toISOString(),
        }));
      }
      console.error(JSON.stringify({
        event: "aviator_continuation_retry",
        workerId, generation, attempt, attemptId, reason: lastFailure,
        elapsedMs: Date.now() - attemptStartedAt,
        at: new Date().toISOString(),
      }));
      if (attempt < 3) await sleep(1_000 * attempt);
    }

    // Release only if the handoff token is still the lease owner. If the
    // continuation was accepted but its response was lost, this is a safe no-op.
    const released = await releaseHandoff();
    console.error(JSON.stringify({
      event: "aviator_continuation_exhausted",
      workerId, generation, reason: lastFailure,
      leaseReleased: released.data === true && !released.error,
      at: new Date().toISOString(),
    }));
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

  const continuationAttemptId = req.headers.get("x-aviator-continuation-attempt-id");
  if (continuationAttemptId && /^[0-9a-f-]{36}$/i.test(continuationAttemptId)) {
    console.info(JSON.stringify({
      event: "aviator_continuation_received",
      attemptId: continuationAttemptId,
      at: new Date().toISOString(),
    }));
  }

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

  const leaseSnapshot = await db.schema("aviator").from("engine_worker_lease")
    .select("generation,lease_expires_at,heartbeat_at")
    .eq("lease_key", "aviator").maybeSingle();
  if (leaseSnapshot.error) {
    console.error("Aviator lease snapshot read failed:", leaseSnapshot.error.code ?? "unknown");
  } else if (!leaseSnapshot.data) {
    console.warn("Aviator lease snapshot returned no row after successful acquisition");
  }
  const generation = leaseSnapshot.data?.generation ?? null;
  const started = Date.now();
  const runForMs = 42_000;
  console.info(JSON.stringify({
    event: "aviator_worker_acquired",
    workerId, generation, leaseExpiresAt: leaseSnapshot.data?.lease_expires_at ?? null,
    at: new Date(started).toISOString(),
  }));
  // The lease TTL is 45s; a 15s heartbeat keeps a 30s safety margin while reducing DB writes by 66%.
  const heartbeatEveryMs = 15_000;
  let nextHeartbeatAt = started + heartbeatEveryMs;
  const tickLatenciesMs: number[] = [];
  const actionCounts: Record<string, number> = {};
  let totalTickRetries = 0;
  let lastAction: unknown = null;

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
      }, 503);
    }

    lastAction = data ?? { action: "no_result" };
    const action =
      typeof lastAction === "object" && lastAction !== null && "action" in lastAction
        ? String((lastAction as { action: unknown }).action)
        : "unknown";
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;

    // Sample only every fifth actual Realtime broadcast to keep log/egress volume low.
    if (typeof lastAction === "object" && lastAction !== null) {
      const sample = lastAction as Record<string, unknown>;
      const sequence = Number(sample.broadcastTickSequence);
      const engineMultiplier = Number(sample.multiplier);
      const broadcastMultiplier = Number(sample.broadcastMultiplier);
      if (Number.isInteger(sequence) && sequence > 0 && sequence % 5 === 0 &&
          Number.isFinite(engineMultiplier) && Number.isFinite(broadcastMultiplier)) {
        console.info(JSON.stringify({
          event: "aviator_multiplier_parity",
          workerId, generation,
          roundId: sample.roundId ?? null,
          tickSequence: sequence,
          engineMultiplier,
          broadcastMultiplier,
          delta: Math.round((engineMultiplier - broadcastMultiplier) * 100) / 100,
          matches: engineMultiplier === broadcastMultiplier,
          at: new Date().toISOString(),
        }));
      }
    }

    if (Date.now() >= nextHeartbeatAt) {
      const heartbeat = await db.schema("aviator").rpc(
        "heartbeat_crash_engine_lease",
        { p_owner_token: workerId, ...leaseArgs },
      );
      if (heartbeat.error || heartbeat.data !== true) {
        console.error(JSON.stringify({
          event: "aviator_worker_lease_lost", workerId, generation,
          at: new Date().toISOString(),
        }));
        return json({
          error: "ENGINE_LEASE_LOST",
          ticksCompleted: tickLatenciesMs.length,
          tickLatencyMs: summarizeLatencies(tickLatenciesMs),
        }, 409);
      }
      nextHeartbeatAt = Date.now() + heartbeatEveryMs;
    }

    // Uniform 1-second cadence across every Aviator lifecycle state.
    // This reduces RPC volume but may add up to ~1s to crash/auto-cashout processing.
    await sleep(1_000);
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

  console.info(JSON.stringify({
    event: "aviator_worker_handoff",
    workerId, generation, ticks: tickLatenciesMs.length,
    actionCounts, at: new Date().toISOString(),
  }));
  const continuationScheduled = scheduleContinuation(
    url, expected, nextHandoffToken,
    () => db.schema("aviator").rpc("release_crash_engine_lease", {
      p_owner_token: nextHandoffToken,
    }),
    workerId, generation,
  );
  if (!continuationScheduled) {
    // The lease expires automatically if the EdgeRuntime continuation facility is unavailable.
    return json({
      ok: true,
      warning: "CONTINUATION_UNAVAILABLE_RECOVERY_WATCHDOG_WILL_RECLAIM_AFTER_EXPIRY",
      ticksCompleted: tickLatenciesMs.length,
      tickLatencyMs: summarizeLatencies(tickLatenciesMs),
      actionCounts,
    }, 200);
  }

  console.info(JSON.stringify({
    event: "aviator_worker_handoff_scheduled",
    workerId, generation, ticks: tickLatenciesMs.length,
    continuationScheduled, at: new Date().toISOString(),
  }));
  return json({
    ok: true,
    ticksCompleted: tickLatenciesMs.length,
    elapsedMs: Date.now() - started,
    tickIntervalMs: { allStates: 1_000 },
    continuationScheduled: true,
    tickLatencyMs: summarizeLatencies(tickLatenciesMs),
    actionCounts,
    tickRetries: totalTickRetries,
    lastAction,
  });
});
