import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("WORKER_NOT_CONFIGURED");
  return value;
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

const permanentErrorCodes = new Set([
  "INVALID_AVIATOR_WALLET_ACTION",
  "AVIATOR_OPERATION_IDS_REQUIRED",
  "AMOUNT_MUST_BE_POSITIVE",
  "INVALID_AVIATOR_LIABILITY",
  "INVALID_AVIATOR_IDEMPOTENCY_KEY",
  "IDEMPOTENCY_KEY_REUSE",
  "USER_NOT_FOUND_OR_DISABLED",
  "PLAYER_ONLY",
  "BET_OUT_OF_RANGE",
  "INVALID_BET_PARAMETERS",
  "ROUND_NOT_FOUND",
  "ROUND_NOT_ACCEPTING_BETS",
]);

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/(?:AVIATOR_|INVALID_|BET_|ROUND_|PLAYER_|USER_|IDEMPOTENCY_|AMOUNT_|WALLET_)[A-Z0-9_:-]*/);
  return (match?.[0] ?? "WALLET_OPERATION_FAILED").slice(0, 80);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let target: ReturnType<typeof createClient>;
  let shared: ReturnType<typeof createClient>;
  let workerSecret: string;
  try {
    target = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    shared = createClient(requiredEnv("BIGDADDY_SHARED_SUPABASE_URL"),
      requiredEnv("BIGDADDY_SHARED_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    workerSecret = requiredEnv("AVIATOR_WORKER_SECRET");
  } catch {
    return json({ error: "WORKER_NOT_CONFIGURED" }, 503);
  }

  const provided = req.headers.get("x-aviator-worker-secret") ?? "";
  if (!constantTimeEqual(provided, workerSecret)) return json({ error: "AUTH_REQUIRED" }, 401);

  let limit = 20;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && body.limit !== undefined) {
      if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100) {
        return json({ error: "INVALID_BATCH_SIZE" }, 400);
      }
      limit = body.limit;
    }
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const { data: operations, error: claimError } = await target.schema("aviator")
    .rpc("claim_wallet_operations", { p_limit: limit });
  if (claimError) {
    console.error("Aviator outbox claim failed:", claimError.code ?? "CLAIM_FAILED");
    return json({ error: "OUTBOX_UNAVAILABLE" }, 503);
  }

  const results: Array<{ operationId: string; status: string }> = [];
  for (const operation of (operations ?? []) as Array<Record<string, unknown>>) {
    const operationId = String(operation.operation_id ?? "");
    try {
      if (operation.operation_type !== "DEBIT_BET" ||
          typeof operation.user_id !== "string" ||
          typeof operation.round_id !== "string" ||
          typeof operation.bet_id !== "string" ||
          typeof operation.idempotency_key !== "string" ||
          typeof operation.amount !== "number" && typeof operation.amount !== "string" ||
          typeof operation.liability !== "number" && typeof operation.liability !== "string") {
        const failure = await target.schema("aviator").rpc("fail_wallet_operation", {
          p_operation_id: operationId,
          p_error_code: "INVALID_OUTBOX_RECORD",
          p_permanent: true,
        });
        results.push({ operationId, status: failure.error ? "RECONCILIATION_REQUIRED" : "FAILED" });
        continue;
      }

      const { data: walletResult, error: walletError } = await shared.schema("wallet").rpc(
        "aviator_wallet_operation",
        {
          p_action: "DEBIT_BET",
          p_user_id: operation.user_id,
          p_bet_id: operation.bet_id,
          p_round_id: operation.round_id,
          p_amount: Number(operation.amount),
          p_liability: Number(operation.liability),
          p_multiplier: null,
          p_idempotency_key: operation.idempotency_key,
        },
      );

      if (walletError) {
        const code = errorCode(walletError);
        const permanent = permanentErrorCodes.has(code);
        const { data: failureStatus, error: failureError } = await target.schema("aviator")
          .rpc("fail_wallet_operation", {
            p_operation_id: operationId,
            p_error_code: code,
            p_permanent: permanent,
          });
        results.push({
          operationId,
          status: failureError ? "RECONCILIATION_REQUIRED" : String(failureStatus ?? "RETRY"),
        });
        continue;
      }

      const transactionId = (walletResult as Record<string, unknown> | null)?.transactionId;
      if (typeof transactionId !== "string") {
        // A successful HTTP response without a transaction ID is ambiguous.
        // Retry with the same idempotency key; never publish the bet as funded.
        const { error: failureError } = await target.schema("aviator").rpc("fail_wallet_operation", {
          p_operation_id: operationId,
          p_error_code: "WALLET_RESULT_AMBIGUOUS",
          p_permanent: false,
        });
        results.push({ operationId, status: failureError ? "RECONCILIATION_REQUIRED" : "RETRY" });
        continue;
      }

      const { error: completeError } = await target.schema("aviator").rpc(
        "complete_wallet_operation",
        { p_operation_id: operationId, p_wallet_transaction_id: transactionId },
      );
      if (completeError) {
        // Wallet debit may already be committed. A later retry replays the same
        // source transaction and can safely finish the target-side status.
        console.error("Aviator outbox completion failed:", completeError.code ?? "COMPLETION_FAILED");
        results.push({ operationId, status: "RECONCILIATION_REQUIRED" });
      } else {
        results.push({ operationId, status: "SUCCEEDED" });
      }
    } catch (error) {
      const code = errorCode(error);
      const { error: failureError } = await target.schema("aviator").rpc("fail_wallet_operation", {
        p_operation_id: operationId,
        p_error_code: code,
        p_permanent: false,
      });
      results.push({ operationId, status: failureError ? "RECONCILIATION_REQUIRED" : "RETRY" });
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  return json({ claimed: results.length, summary, results });
});
