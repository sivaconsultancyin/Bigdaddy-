import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("WORKER_NOT_CONFIGURED");
  return value;
}
function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
function errorCode(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/(?:AVIATOR_|INVALID_|BET_|ROUND_|PLAYER_|USER_|IDEMPOTENCY_|AMOUNT_|WALLET_|PAYOUT_|GAME_POOL_|SETTLEMENT_|RESERVATION_)[A-Z0-9_:-]*/);
  return (match?.[0] ?? "WALLET_OPERATION_FAILED").slice(0, 80);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  let target: ReturnType<typeof createClient>, shared: ReturnType<typeof createClient>, secret: string;
  try {
    target = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } });
    shared = createClient(requiredEnv("BIGDADDY_SHARED_SUPABASE_URL"),
      requiredEnv("BIGDADDY_SHARED_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } });
    secret = requiredEnv("AVIATOR_SETTLEMENT_WORKER_SECRET");
  } catch { return json({ error: "WORKER_NOT_CONFIGURED" }, 503); }
  if (!constantTimeEqual(req.headers.get("x-aviator-settlement-secret") ?? "", secret))
    return json({ error: "AUTH_REQUIRED" }, 401);

  let limit = 20;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && body.limit !== undefined) {
      if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100)
        return json({ error: "INVALID_BATCH_SIZE" }, 400);
      limit = body.limit;
    }
  } catch { return json({ error: "INVALID_JSON" }, 400); }

  const results: Array<{ id: string; kind: string; status: string }> = [];
  async function processBatch(kind: "payout" | "loss", rpcName: string) {
    const { data, error } = await target.schema("aviator").rpc(rpcName, { p_limit: limit });
    if (error) {
      console.error("Aviator settlement claim failed:", error.code ?? "CLAIM_FAILED");
      results.push({ id: "batch", kind, status: "CLAIM_FAILED" });
      return;
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(kind === "payout" ? row.settlement_id ?? "" : row.operation_id ?? "");
      const betId = row.bet_id, userId = row.user_id, roundId = row.round_id;
      const amount = row.amount, liability = row.liability, key = row.idempotency_key;
      const multiplier = kind === "payout" ? row.multiplier : null;
      try {
        if (typeof betId !== "string" || typeof userId !== "string" || typeof roundId !== "string" ||
            typeof key !== "string" || (typeof amount !== "number" && typeof amount !== "string") ||
            (typeof liability !== "number" && typeof liability !== "string") ||
            (kind === "payout" && (typeof multiplier !== "number" && typeof multiplier !== "string"))) {
          const failureRpc = kind === "payout" ? "fail_payout_settlement" : "fail_crash_loss_operation";
          await target.schema("aviator").rpc(failureRpc, {
            [kind === "payout" ? "p_settlement_id" : "p_operation_id"]: id,
            p_error_code: "INVALID_OUTBOX_RECORD",
          });
          results.push({ id, kind, status: "RETRY" });
          continue;
        }
        const { data: walletResult, error: walletError } = await shared.schema("wallet").rpc(
          "aviator_wallet_operation", {
            p_action: kind === "payout" ? "CASHOUT" : "CRASH_LOSS",
            p_user_id: userId, p_bet_id: betId, p_round_id: roundId,
            p_amount: String(amount), p_liability: String(liability),
            p_multiplier: multiplier === null ? null : String(multiplier),
            p_idempotency_key: key,
          });
        if (walletError) {
          const { error: failError } = await target.schema("aviator").rpc(
            kind === "payout" ? "fail_payout_settlement" : "fail_crash_loss_operation", {
              [kind === "payout" ? "p_settlement_id" : "p_operation_id"]: id,
              p_error_code: errorCode(walletError),
            });
          results.push({ id, kind, status: failError ? "RECONCILIATION_REQUIRED" : "RETRY" });
          continue;
        }
        const transactionId = (walletResult as Record<string, unknown> | null)?.transactionId;
        if (typeof transactionId !== "string") {
          const { error: failError } = await target.schema("aviator").rpc(
            kind === "payout" ? "fail_payout_settlement" : "fail_crash_loss_operation", {
              [kind === "payout" ? "p_settlement_id" : "p_operation_id"]: id,
              p_error_code: "WALLET_RESULT_AMBIGUOUS",
            });
          results.push({ id, kind, status: failError ? "RECONCILIATION_REQUIRED" : "RETRY" });
          continue;
        }
        const { error: completeError } = await target.schema("aviator").rpc(
          kind === "payout" ? "complete_payout_settlement" : "complete_crash_loss_operation", {
            [kind === "payout" ? "p_settlement_id" : "p_operation_id"]: id,
            p_wallet_transaction_id: transactionId,
          });
        results.push({ id, kind, status: completeError ? "RECONCILIATION_REQUIRED" : "SUCCEEDED" });
      } catch (error) {
        const { error: failError } = await target.schema("aviator").rpc(
          kind === "payout" ? "fail_payout_settlement" : "fail_crash_loss_operation", {
            [kind === "payout" ? "p_settlement_id" : "p_operation_id"]: id,
            p_error_code: errorCode(error),
          });
        results.push({ id, kind, status: failError ? "RECONCILIATION_REQUIRED" : "RETRY" });
      }
    }
  }

  await processBatch("payout", "claim_payout_settlements");
  await processBatch("loss", "claim_crash_loss_operations");
  const summary = results.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  return json({ claimed: results.filter((r) => r.id !== "batch").length, summary, results });
});
