import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

type ResponseFactory = (body: Record<string, unknown>, status?: number, origin?: string | null) => Response;
type TokenVerifier = (token: string) => Promise<any>;
type AmountValidator = (value: unknown) => string | null;
type ActorResolver = (req: Request, db: SupabaseClient) => Promise<{ actor?: any; error?: string; status?: number }>;
let aviatorStateRequestCount = 0;

export async function handleAviatorApi(
  req: Request,
  path: string,
  origin: string | null,
  db: SupabaseClient,
  response: ResponseFactory,
  verifyBigDaddyToken: TokenVerifier,
  positiveAmount: AmountValidator,
  actorFrom: ActorResolver,
  requestStartedAt: number,
): Promise<Response | null> {
  if (!path.startsWith("/games/aviator/")) return null;

    // Fast path for Aviator bets: validate the signed token locally, then let one
    // SECURITY DEFINER RPC re-check active-user/role state, create the bet atomically,
    // and return the persisted bet row. This avoids separate user, role, and readback
    // PostgREST requests without trusting the token for current authorization state.
    if (req.method === "POST" && path === "/games/aviator/bet") {
      const authorization = req.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer ")) return response({ error: "AUTH_REQUIRED" }, 401, origin);
      const claims = await verifyBigDaddyToken(authorization.slice(7).trim());
      if (!claims) return response({ error: "INVALID_TOKEN" }, 401, origin);
      if (claims.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
  
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
      const amount = positiveAmount(body.amount);
      const autoCashout = body.autoCashoutMultiplier == null ? null : Number(body.autoCashoutMultiplier);
      if (!amount || (autoCashout !== null && (!Number.isFinite(autoCashout) || autoCashout < 1.01 || autoCashout > 50))) {
        return response({ error: "INVALID_BET" }, 400, origin);
      }
      const key = req.headers.get("idempotency-key")?.trim() ?? "";
      if (key.length < 8 || key.length > 119 || !/^[A-Za-z0-9_-]+$/.test(key)) return response({ error: "INVALID_IDEMPOTENCY_KEY" }, 400, origin);
  
      const { data, error } = await db.schema("aviator").rpc("place_crash_bet_authenticated_atomic", {
        p_user_id: claims.id,
        p_claimed_role: claims.role,
        p_amount: amount,
        p_idempotency_key: key,
        p_auto_cashout: autoCashout,
      });
      if (error) {
        const message = error.message ?? "";
        if (/INSUFFICIENT_FUNDS/i.test(message)) return response({ error: "INSUFFICIENT_FUNDS" }, 400, origin);
        if (/USER_NOT_FOUND_OR_DISABLED/i.test(message)) return response({ error: "USER_NOT_FOUND_OR_DISABLED" }, 401, origin);
        if (/TOKEN_ROLE_STALE/i.test(message)) return response({ error: "TOKEN_ROLE_STALE" }, 401, origin);
        if (/PLAYER_ONLY/i.test(message)) return response({ error: "PLAYER_ONLY" }, 403, origin);
        if (/AUTH_SERVICE_UNAVAILABLE|BET_CREATED_BUT_READBACK_FAILED/i.test(message)) return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin);
        if (/NO_OPEN_ROUND|BETTING_CLOSED/i.test(message)) return response({ error: "NO_OPEN_ROUND" }, 409, origin);
        if (/IDEMPOTENCY_KEY_REUSE/i.test(message)) return response({ error: "IDEMPOTENCY_KEY_REUSE" }, 409, origin);
        return response({ error: "BET_REJECTED" }, 400, origin);
      }
      if (data?.error === "NO_OPEN_ROUND") return response({ error: "NO_OPEN_ROUND" }, 409, origin);
      if (!data?.bet) return response({ error: "BET_REJECTED" }, 400, origin);
      return response(data, 201, origin);
    }
  
    // Cashout uses a single authenticated database RPC. JWT signature validation
    // stays in the Edge Function; account/role checks and financial settlement run
    // together in Postgres to remove one serial PostgREST round-trip from the hot path.
    if (req.method === "POST" && path === "/games/aviator/cashout") {
      const header = req.headers.get("authorization") ?? "";
      if (!header.startsWith("Bearer ")) return response({ error: "AUTH_REQUIRED" }, 401, origin);
      const claims = await verifyBigDaddyToken(header.slice(7).trim());
      if (!claims) return response({ error: "INVALID_TOKEN" }, 401, origin);
      if (claims.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
  
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
      const betId = String(body.betId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(betId)) return response({ error: "INVALID_BET_ID" }, 400, origin);
      const key = req.headers.get("idempotency-key")?.trim() || `CASHOUT_${betId.replace(/-/g, "")}`;
      if (key.length < 8 || key.length > 96 || !/^[A-Za-z0-9_-]+$/.test(key)) {
        return response({ error: "INVALID_CASHOUT_IDEMPOTENCY_KEY" }, 400, origin);
      }
  
      const { data, error } = await db.schema("aviator").rpc("cashout_crash_bet_authenticated_atomic", {
        p_user_id: claims.id, p_claimed_role: claims.role, p_bet_id: betId, p_idempotency_key: key,
      });
      if (error || !data) {
        const message = error?.message ?? "";
        if (/USER_NOT_FOUND_OR_DISABLED/i.test(message)) return response({ error: "USER_NOT_FOUND_OR_DISABLED" }, 401, origin);
        if (/TOKEN_ROLE_STALE/i.test(message)) return response({ error: "TOKEN_ROLE_STALE" }, 401, origin);
        if (/PLAYER_ONLY/i.test(message)) return response({ error: "PLAYER_ONLY" }, 403, origin);
        if (/AUTH_SERVICE_UNAVAILABLE/i.test(message)) return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin);
        return response({ error: /ALREADY|CASHOUT|SETTLED|ROUND/i.test(message) ? "BET_ALREADY_CASHED_OUT_OR_UNAVAILABLE" : "CASHOUT_REJECTED" }, 409, origin);
      }
      return response({ result: data }, 200, origin);
    }

  if (req.method === "GET" && (path === "/games/aviator/state" || path === "/games/aviator/history")) {
    const auth = await actorFrom(req, db);
    if (!auth.actor) {
      if (path === "/games/aviator/state") {
        console.error(JSON.stringify({ event: "aviator_state_api_timing", httpStatus: auth.status ?? 401, totalMs: Math.round(performance.now() - requestStartedAt), errorCode: auth.error ?? "AUTH_REQUIRED" }));
      }
      return response({ error: auth.error ?? "AUTH_REQUIRED" }, auth.status ?? 401, origin);
    }
  }

    if (req.method === "GET" && path === "/games/aviator/state") {
      aviatorStateRequestCount += 1;
      // One PostgREST RPC returns the current round, recent history and current-round
      // bets with usernames. Do not fan this hot one-second polling endpoint out into
      // separate rounds, bets, and users requests.
      const rpcStartedAt = performance.now();
      const { data, error } = await db.schema("aviator").rpc("get_aviator_state_bundle");
      const rpcDurationMs = Math.round(performance.now() - rpcStartedAt);
      if (error || !data || typeof data !== "object") {
        console.error(JSON.stringify({
          event: "aviator_state_api_timing",
          httpStatus: 503,
          totalMs: Math.round(performance.now() - requestStartedAt),
          rpcMs: rpcDurationMs,
          errorCode: error?.code ?? "INVALID_STATE_BUNDLE",
        }));
        return response({ error: "GAME_SERVICE_UNAVAILABLE" }, 503, origin);
      }
      const rounds = Array.isArray(data.rounds) ? data.rounds : [];
      const row = data.round ?? null;
      const history = rounds.filter((r: any) => r.status === "CRASHED" || r.status === "SETTLED").map((r: any) => ({
        roundNumber: Number(r.round_number), crashMultiplier: Number(r.crash_multiplier ?? 0), endedAt: r.ended_at,
        serverSeedHash: r.server_seed_hash, revealedServerSeed: r.revealed_server_seed,
      }));
      if (!row) {
        const totalMs = Math.round(performance.now() - requestStartedAt);
        if (totalMs >= 250 || aviatorStateRequestCount % 20 === 0) {
          console.log(JSON.stringify({
            event: "aviator_state_api_timing", httpStatus: 200, totalMs, rpcMs: rpcDurationMs,
            roundId: null, status: null, multiplier: null,
          }));
        }
        return response({ round: null, bets: [], history, serverTime: new Date().toISOString() }, 200, origin);
      }
      const elapsedSeconds = Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000);
      const liveMultiplier = Math.floor(Math.exp(0.06 * Math.pow(elapsedSeconds, 1.15)) * 100) / 100;
      const crashed = ["CRASHED","SETTLED"].includes(row.status);
      const multiplier = row.status === "RUNNING" ? Math.min(liveMultiplier, Number(row.crash_multiplier ?? liveMultiplier)) : crashed ? Number(row.crash_multiplier ?? 1) : 1;
      const bets = (Array.isArray(data.bets) ? data.bets : []).map((b: any) => ({
        id:b.id, roundId:b.round_id, betAmount:String(b.bet_amount), autoCashout:b.auto_cashout,
        status:b.status, payoutAmount:String(b.payout_amount ?? 0), cashedOutAt:b.cashed_out_at,
        username:b.username ?? "Player",
      }));
      const current = {
        id:row.id, roundNumber:Number(row.round_number), status:row.status, startedAt:row.started_at,
        endedAt:row.ended_at, multiplier, crashMultiplier:crashed ? row.crash_multiplier : null,
        serverSeedHash:row.server_seed_hash, revealedServerSeed:row.revealed_server_seed,
      };
      const totalMs = Math.round(performance.now() - requestStartedAt);
      if (totalMs >= 250 || aviatorStateRequestCount % 20 === 0) {
        console.log(JSON.stringify({
          event: "aviator_state_api_timing",
          httpStatus: 200,
          totalMs,
          rpcMs: rpcDurationMs,
          roundId: current.id,
          status: current.status,
          multiplier: current.multiplier,
        }));
      }
      return response({ round: current, bets, history, serverTime: new Date().toISOString() }, 200, origin);
    }
  
    if (req.method === "GET" && path === "/games/aviator/history") {
      const { data, error } = await db.schema("aviator").from("game_rounds")
        .select("round_number,crash_multiplier,ended_at,server_seed_hash,revealed_server_seed")
        .eq("game_code","aviator").in("status",["CRASHED","SETTLED"]).order("round_number",{ascending:false}).limit(20);
      if (error) return response({ error: "GAME_STORAGE_UNAVAILABLE" }, 503, origin);
      return response({ history: (data ?? []).map(r => ({ roundNumber:Number(r.round_number), crashMultiplier:r.crash_multiplier == null ? null : Number(r.crash_multiplier), endedAt:r.ended_at, serverSeedHash:r.server_seed_hash, revealedServerSeed:r.revealed_server_seed })) }, 200, origin);
    }
  return null;
}
