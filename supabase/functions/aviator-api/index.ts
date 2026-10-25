import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { jwtVerify } from "npm:jose@5.9.6";

type Claims = { id: string; username: string; role: "OWNER" | "SUPER_ADMIN" | "ADMIN" | "PLAYER"; parentId: string | null };

const json = (body: Record<string, unknown>, status = 200, origin: string | null = null) => {
  const configured = (Deno.env.get("BIGDADDY_ALLOWED_ORIGINS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const native = ["https://localhost", "capacitor://localhost", "ionic://localhost", "http://localhost"];
  const allowed = new Set([...configured, ...native]);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (!configured.length) headers["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
};

function clients() {
  const targetUrl = Deno.env.get("SUPABASE_URL");
  const targetKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sharedUrl = Deno.env.get("BIGDADDY_SHARED_SUPABASE_URL");
  const sharedKey = Deno.env.get("BIGDADDY_SHARED_SERVICE_ROLE_KEY");
  const jwtSecret = Deno.env.get("BIGDADDY_JWT_SECRET");
  if (!targetUrl || !targetKey || !sharedUrl || !sharedKey || !jwtSecret || jwtSecret.length < 32) {
    throw new Error("AVIATOR_API_NOT_CONFIGURED");
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    target: createClient(targetUrl, targetKey, options),
    shared: createClient(sharedUrl, sharedKey, options),
    jwtSecret: new TextEncoder().encode(jwtSecret),
  };
}

async function authenticate(req: Request, shared: ReturnType<typeof createClient>, secret: Uint8Array): Promise<Claims | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(header.slice(7).trim(), secret, { algorithms: ["HS256"] });
    if (protectedHeader.alg !== "HS256" || typeof payload.id !== "string" ||
        typeof payload.username !== "string" ||
        !["OWNER", "SUPER_ADMIN", "ADMIN", "PLAYER"].includes(String(payload.role))) return null;

    const { data: user, error: userError } = await shared.schema("platform").from("users")
      .select("id,username,parent_id,is_active").eq("id", payload.id).maybeSingle();
    if (userError || !user?.is_active) return null;

    const { data: roles, error: roleError } = await shared.schema("platform").from("role_assignments")
      .select("role").eq("user_id", user.id).limit(2);
    if (roleError || !roles || roles.length !== 1 || roles[0].role !== payload.role) return null;
    return {
      id: user.id,
      username: user.username,
      role: payload.role as Claims["role"],
      parentId: user.parent_id ?? null,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return json({}, 200, origin);
  if (req.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  let target: ReturnType<typeof createClient>;
  let shared: ReturnType<typeof createClient>;
  let jwtSecret: Uint8Array;
  try {
    ({ target, shared, jwtSecret } = clients());
  } catch {
    return json({ error: "AVIATOR_API_NOT_CONFIGURED" }, 503, origin);
  }

  const actor = await authenticate(req, shared, jwtSecret);
  if (!actor) return json({ error: "AUTH_REQUIRED" }, 401, origin);

  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/games/aviator/state")) {
    const { data, error } = await target.schema("aviator").rpc("get_aviator_state_bundle");
    if (error || !data || typeof data !== "object") {
      console.error("Aviator state bundle failed:", error?.code ?? "INVALID_STATE_BUNDLE");
      return json({ error: "GAME_SERVICE_UNAVAILABLE" }, 503, origin);
    }

    const row = (data as Record<string, any>).round ?? null;
    const historyRows = Array.isArray((data as Record<string, any>).rounds) ? (data as Record<string, any>).rounds : [];
    const history = historyRows
      .filter((round: any) => round.status === "CRASHED" || round.status === "SETTLED")
      .map((round: any) => ({
        roundNumber: Number(round.round_number),
        crashMultiplier: Number(round.crash_multiplier ?? 0),
        endedAt: round.ended_at,
        serverSeedHash: round.server_seed_hash,
        revealedServerSeed: round.revealed_server_seed,
      }));
    if (!row) return json({ round: null, bets: [], history, serverTime: new Date().toISOString() }, 200, origin);

    const crashed = ["CRASHED", "SETTLED"].includes(row.status);
    const elapsed = Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000);
    const exponent = 0.06 * Math.pow(elapsed, 1.15);
    const live = Math.min(100000, Math.floor(Math.exp(Math.min(Math.log(100000), exponent)) * 100) / 100);
    const multiplier = row.status === "RUNNING"
      ? Math.min(live, Number(row.crash_multiplier ?? live))
      : crashed ? Number(row.crash_multiplier ?? 1) : 1;
    const betRows = Array.isArray((data as Record<string, any>).bets) ? (data as Record<string, any>).bets : [];
    return json({
      round: {
        id: row.id,
        roundNumber: Number(row.round_number),
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        multiplier,
        crashMultiplier: crashed ? row.crash_multiplier : null,
        serverSeedHash: row.server_seed_hash,
        revealedServerSeed: row.revealed_server_seed,
      },
      bets: betRows.map((bet: any) => ({
        id: bet.id,
        roundId: bet.round_id,
        betAmount: String(bet.bet_amount),
        autoCashout: bet.auto_cashout,
        status: bet.status,
        payoutAmount: String(bet.payout_amount ?? 0),
        cashedOutAt: bet.cashed_out_at,
        username: "Player",
      })),
      history,
      serverTime: new Date().toISOString(),
    }, 200, origin);
  }

  if (path.endsWith("/games/aviator/history")) {
    const { data, error } = await target.schema("aviator").from("game_rounds")
      .select("round_number,crash_multiplier,ended_at,server_seed_hash,revealed_server_seed")
      .eq("game_code", "aviator").in("status", ["CRASHED", "SETTLED"])
      .order("round_number", { ascending: false }).limit(20);
    if (error) return json({ error: "GAME_STORAGE_UNAVAILABLE" }, 503, origin);
    return json({
      history: (data ?? []).map((round: any) => ({
        roundNumber: Number(round.round_number),
        crashMultiplier: round.crash_multiplier == null ? null : Number(round.crash_multiplier),
        endedAt: round.ended_at,
        serverSeedHash: round.server_seed_hash,
        revealedServerSeed: round.revealed_server_seed,
      })),
    }, 200, origin);
  }

  return json({ error: "NOT_FOUND" }, 404, origin);
});
