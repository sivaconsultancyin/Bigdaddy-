import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import bcrypt from "npm:bcryptjs@2.4.3";
import { corsHeaders, jsonResponse, signBigDaddyToken, verifyBigDaddyToken, type BigDaddyClaims } from "./bigdaddy-jwt.ts";

type Role = "OWNER" | "SUPER_ADMIN" | "ADMIN" | "PLAYER";
type Actor = BigDaddyClaims & { parentId: string | null };
const roles: Role[] = ["OWNER", "SUPER_ADMIN", "ADMIN", "PLAYER"];

function response(body: Record<string, unknown>, status = 200, origin?: string | null) {
  const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" };
  const allowed = (Deno.env.get("BIGDADDY_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length > 0) {
    // Do not leave the default wildcard in place when an allowlist is configured.
    delete headers["Access-Control-Allow-Origin"];
    delete headers["Vary"];
    if (origin && allowed.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return new Response(JSON.stringify(body), { status, headers });
}
function fail(error: string, status = 400) { return { body: { error }, status }; }
function positiveAmount(value: unknown): string | null {
  const raw = String(value ?? "");
  if (!/^[1-9][0-9]{0,14}$/.test(raw)) return null;
  return raw;
}
function safeUser(user: Record<string, any>) {
  return {
    id: user.id, username: user.username, email: user.email, role: user.role,
    parentId: user.parent_id ?? null, referredBy: user.referred_by_user_id ?? null,
    referralCode: user.referral_code ?? null,
  };
}
function walletShape(row: Record<string, any> | null) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id ?? row.userId ?? null,
    walletType: row.wallet_type ?? row.walletType,
    balance: String(row.balance ?? "0"),
    reservedBalance: String(row.reserved_balance ?? row.reservedBalance ?? "0"),
    gameCode: row.game_code ?? row.gameCode ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}
function client(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SERVER_CONFIGURATION_ERROR");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function actorFrom(req: Request, db: SupabaseClient): Promise<{ actor?: Actor; error?: string; status?: number }> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { error: "AUTH_REQUIRED", status: 401 };
  const claims = await verifyBigDaddyToken(header.slice(7).trim());
  if (!claims) return { error: "INVALID_TOKEN", status: 401 };
  const { data: user, error: userError } = await db.schema("platform").from("users")
    .select("id,username,parent_id,is_active").eq("id", claims.id).maybeSingle();
  if (userError) return { error: "AUTH_SERVICE_UNAVAILABLE", status: 503 };
  if (!user || !user.is_active) return { error: "USER_NOT_FOUND_OR_DISABLED", status: 401 };
  const { data: roleRows, error: roleError } = await db.schema("platform").from("role_assignments")
    .select("role").eq("user_id", claims.id).limit(2);
  if (roleError || !roleRows || roleRows.length !== 1) return { error: "AUTH_SERVICE_UNAVAILABLE", status: 503 };
  if (roleRows[0].role !== claims.role) return { error: "TOKEN_ROLE_STALE", status: 401 };
  return { actor: { ...claims, username: user.username, parentId: user.parent_id ?? null } };
}
async function getWallet(db: SupabaseClient, actor: Actor) {
  let query = db.schema("wallet").from("wallets")
    .select("id,user_id,wallet_type,balance,reserved_balance,game_code,created_at,updated_at");
  query = actor.role === "OWNER" ? query.eq("wallet_type", "TREASURY") : query.eq("user_id", actor.id);
  const { data, error } = await query.limit(1);
  if (error) throw new Error("WALLET_SERVICE_UNAVAILABLE");
  return data?.[0] ?? null;
}
async function audit(db: SupabaseClient, actorId: string, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
  const { error } = await db.schema("platform").from("audit_logs").insert({
    actor_id: actorId, action, target_type: targetType, target_id: targetId, details,
  });
  if (error) throw new Error("AUDIT_WRITE_FAILED");
}

async function readAuthoritativeState(db: SupabaseClient, code: string) {
  const { data: rounds, error } = await db.schema(code).from("authoritative_game_rounds").select("*").eq("game_code", code).order("round_number", { ascending: false }).limit(25);
  if (error || !rounds?.length) return { gameStateUnavailable: true };
  const round = rounds.find(r => ["BETTING","RUNNING","RESULT"].includes(r.status)) ?? rounds[0];
  return { round: { id: round.id, roundNumber: Number(round.round_number), status: round.status, bettingEndsAt: new Date(round.betting_closes_at).getTime(), openedAt: new Date(round.opened_at).getTime(), result: ["RUNNING","RESULT","SETTLED"].includes(round.status) ? round.result : null, serverSeedHash: round.server_seed_hash, revealedServerSeed: round.status === "SETTLED" ? round.server_seed : null } };
}

async function handle(req: Request) {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/api(?=\/|$)/, "").replace(/^\/api(?=\/)/, "").replace(/\/$/, "") || "/";
  if (req.method === "GET" && path === "/health") {
    try {
      const healthDb = client();
      const { error } = await healthDb.schema("platform").from("users").select("id", { head: true, count: "exact" });
      if (error) return response({ status:"degraded",databaseConnected:false,mode:"production",productionFinancialApisEnabled:false },503,origin);
      return response({ status:"ok",service:"BigDaddy Supabase API",databaseConnected:true,mode:"production",productionFinancialApisEnabled:true },200,origin);
    } catch { return response({ status:"degraded",databaseConnected:false,mode:"production",productionFinancialApisEnabled:false },503,origin); }
  }
  if (req.method === "GET" && path === "/ready") {
    // Readiness must reflect a real database round-trip, not just a live process.
    try {
      const readinessDb = client();
      const { error } = await readinessDb.schema("platform").from("users").select("id", { head: true, count: "exact" });
      if (error) return response({ ready: false, database: "unavailable" }, 503, origin);
      return response({ ready: true, database: "supabase-https" }, 200, origin);
    } catch {
      return response({ ready: false, database: "unavailable" }, 503, origin);
    }
  }
  if (req.method === "GET" && path === "/config") {
    try {
      const configDb = client();
      const { data: activeGames, error } = await configDb.schema("platform").from("games")
        .select("code").eq("status", "ACTIVE").order("code");
      if (error) return response({ error: "CONFIG_UNAVAILABLE" }, 503, origin);
      const supported = new Set(["aviator", "roulette", "dice", "dragon_tiger", "andar_bahar"]);
      return response({
        mode: "production", currency: "tokens", apiBackend: "supabase",
        games: (activeGames ?? []).map((game) => game.code).filter((code) => supported.has(code)),
      }, 200, origin);
    } catch {
      return response({ error: "CONFIG_UNAVAILABLE" }, 503, origin);
    }
  }
  // Stateless provably-fair Dice verification; does not require a user session or database write.
  if (req.method === "POST" && path === "/games/dice/verify") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const serverSeed = typeof body.serverSeed === "string" ? body.serverSeed : "";
    const clientSeed = typeof body.clientSeed === "string" && body.clientSeed.length > 0 ? body.clientSeed : "client-seed-live";
    const nonceRaw = body.nonce;
    const nonce = typeof nonceRaw === "number" ? nonceRaw : Number.parseInt(String(nonceRaw ?? ""), 10);
    if (!serverSeed || serverSeed.length > 1024 || nonceRaw === undefined || !Number.isSafeInteger(nonce) || nonce < 0 || clientSeed.length > 256) {
      return response({ error: "INVALID_VERIFICATION_PARAMETERS" }, 400, origin);
    }
    const encoder = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
      "raw", encoder.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const hmacBytes = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(`${clientSeed}:${nonce}`)));
    const hmacHex = Array.from(hmacBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const seedHashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(serverSeed)));
    const serverSeedHash = Array.from(seedHashBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const calculatedRoll = (Number.parseInt(hmacHex.slice(0, 8), 16) % 10) + 1;
    return response({ serverSeed, serverSeedHash, clientSeed, nonce, calculatedRoll }, 200, origin);
  }

  let db: SupabaseClient;
  try { db = client(); } catch { return response({ error: "SERVER_CONFIGURATION_ERROR" }, 500, origin); }

  // Public login: same BigDaddy HS256 token contract as the existing backend.
  if (req.method === "POST" && path === "/auth/login") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const validLoginName = /^[a-zA-Z0-9_.-]{3,64}$/.test(username) || /^[^\s@]{1,128}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/.test(username);
    if (!validLoginName || password.length < 1 || password.length > 1024) {
      return response({ error: "INVALID_USERNAME_OR_PASSWORD" }, 400, origin);
    }
    const userLookup = db.schema("platform").from("users")
      .select("id,username,email,password_hash,parent_id,referred_by_user_id,is_active");
    // Email login is accepted by validation above, so query the email column for it.
    const { data: users, error: userError } = username.includes("@")
      ? await userLookup.eq("email", username.toLowerCase()).limit(2)
      : await userLookup.ilike("username", username).limit(2);
    if (userError) return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin);
    if (!users || users.length !== 1 || !users[0].is_active || !(await bcrypt.compare(password, users[0].password_hash))) {
      return response({ error: "INVALID_USERNAME_OR_PASSWORD" }, 401, origin);
    }
    const user = users[0];
    const { data: roleRows, error: roleError } = await db.schema("platform").from("role_assignments")
      .select("role").eq("user_id", user.id).limit(2);
    if (roleError || !roleRows || roleRows.length !== 1 || !roles.includes(roleRows[0].role)) {
      return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin);
    }
    const referral = await db.schema("platform").from("referral_codes").select("code")
      .eq("owner_user_id", user.id).eq("is_active", true).limit(1);
    if (referral.error) return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin);
    const actor = { id: user.id, username: user.username, role: roleRows[0].role as Role, parentId: user.parent_id ?? null };
    let wallet: Record<string, any> | null;
    try { wallet = await getWallet(db, actor); } catch { return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin); }
    const token = await signBigDaddyToken(actor);
    try { await audit(db, user.id, "USER_LOGIN", "USER", user.id, { source: "supabase-edge-api" }); }
    catch { return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin); }
    return response({ token, user: safeUser({ ...user, role: actor.role, referral_code: referral.data?.[0]?.code ?? null }), wallet: walletShape(wallet) }, 200, origin);
  }


  if (req.method === "POST" && path === "/auth/register-referral") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const referralCode = typeof body.referralCode === "string" ? body.referralCode.trim() : "";
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 1024 || referralCode.length < 3 || referralCode.length > 64) return response({ error: "INVALID_INPUT" }, 400, origin);
    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await db.schema("platform").rpc("register_referral_atomic", { p_username: username, p_email: email, p_password_hash: passwordHash, p_referral_code: referralCode });
    if (error || !data?.user) {
      const message = error?.message ?? "";
      const code = message.includes("INVALID_REFERRAL_CODE") ? "INVALID_REFERRAL_CODE" : message.includes("DUPLICATE_ACCOUNT") || message.includes("unique") ? "USERNAME_OR_EMAIL_ALREADY_REGISTERED" : "REGISTRATION_FAILED";
      return response({ error: code }, code === "USERNAME_OR_EMAIL_ALREADY_REGISTERED" ? 409 : 400, origin);
    }
    const token = await signBigDaddyToken({ id:data.user.id, username:data.user.username, role:"PLAYER", parentId:data.user.parentId ?? null });
    return response({ token, user:data.user, wallet:data.wallet }, 201, origin);
  }

  const gameStateMatch = path.match(/^\/games\/(roulette|dice|dragon-tiger|andar-bahar)\/state$/);
  if (req.method === "GET" && gameStateMatch) {
    const code = gameStateMatch[1] === "dragon-tiger" ? "dragon_tiger" : gameStateMatch[1] === "andar-bahar" ? "andar_bahar" : gameStateMatch[1];
    // Secondary-game state can include usernames and bet details. Authenticate
    // before returning either live state or the empty COMING_SOON response.
    const stateAuth = await actorFrom(req, db);
    if (!stateAuth.actor) return response({ error: stateAuth.error ?? "AUTH_REQUIRED" }, stateAuth.status ?? 401, origin);
    // Disabled games are intentionally not serving live rounds. Return a stable
    // non-error response before querying their game-specific tables so stale
    // clients do not generate repeated 503s or operational-alert noise.
    const { data: gameConfig, error: gameConfigError } = await db.schema("platform").from("games")
      .select("status").eq("code", code).maybeSingle();
    if (gameConfigError) return response({ error: "GAME_SERVICE_UNAVAILABLE" }, 503, origin);
    if (!gameConfig || gameConfig.status !== "ACTIVE") {
      return response({
        gameCode: code, status: "COMING_SOON", gameStateUnavailable: true,
        round: null, history: [], bets: [], allBets: [],
      }, 200, origin);
    }
    const { data: rounds, error: roundError } = await db.schema(code).from("authoritative_game_rounds").select("*").eq("game_code", code).order("round_number", { ascending: false }).limit(25);
    if (roundError) return response({ error: "GAME_STATE_UNAVAILABLE" }, 503, origin);
    if (!rounds?.length) return response({ error: "GAME_NOT_CONFIGURED", gameCode: code }, 503, origin);
    const row = rounds.find(r => ["BETTING","RUNNING","RESULT"].includes(r.status)) ?? rounds[0];
    const result = ["RUNNING","RESULT","SETTLED"].includes(row.status) ? row.result : null;
    const current: Record<string, any> = {
      id: row.id, roundNumber: Number(row.round_number),
      status: row.status === "SETTLED" ? "RESULT" : row.status === "RUNNING" ? (code === "roulette" ? "SPINNING" : code === "dice" ? "ROLLING" : code === "dragon_tiger" ? "REVEALING" : "DEALING") : row.status,
      bettingEndsAt: new Date(row.betting_closes_at).getTime(), openedAt: new Date(row.opened_at).getTime(),
      totalBetsCount: Number(row.state?.totalBetsCount ?? 0), totalBetAmount: String(row.state?.totalBetAmount ?? "0"),
      serverSeedHash: row.server_seed_hash, revealedServerSeed: row.status === "SETTLED" ? row.server_seed : null,
    };
    if (code === "roulette") { current.spinEndsAt = current.bettingEndsAt + 1500; current.winningNumber = result?.number ?? null; current.color = result?.color ?? null; }
    if (code === "dice") { current.rolledNumber = result?.number ?? null; current.numberBetsAmount = {}; }
    if (code === "dragon_tiger") { current.dragonCard = result?.dragonCard ?? null; current.tigerCard = result?.tigerCard ?? null; current.winner = result?.winner ?? null; current.dragonBetAmount = "0"; current.tigerBetAmount = "0"; current.tieBetAmount = "0"; }
    if (code === "andar_bahar") { current.jokerCard = result?.jokerCard ?? null; current.dealCards = result?.dealCards ?? []; current.winningSide = result?.winner ?? null; current.winningCard = result?.dealCards?.[Math.max(0,(result?.dealCards?.length ?? 1)-1)]?.card ?? null; current.totalCardsDealt = result?.totalCardsDealt ?? 0; current.firstSide = "bahar"; current.andarBetAmount = "0"; current.baharBetAmount = "0"; }
    const { data: bets, error: betsError } = await db.schema(code).from("authoritative_game_bets").select("id,user_id,bet_amount,selection,status,payout_amount").eq("round_id", row.id).order("created_at", { ascending: false }).limit(100);
    if (betsError) return response({ error: "GAME_STATE_UNAVAILABLE" }, 503, origin);
    const userIds = [...new Set((bets ?? []).map(b => b.user_id))];
    const { data: users } = userIds.length ? await db.schema("platform").from("users").select("id,username").in("id", userIds) : { data: [] };
    const names = new Map((users ?? []).map(u => [u.id,u.username]));
    const mappedBets = (bets ?? []).map(b => ({ id:b.id, amount:String(b.bet_amount), type:b.selection?.type, selection:b.selection, status:b.status, payoutAmount:String(b.payout_amount ?? 0), username:names.get(b.user_id) ?? "Player" }));
    const totals = new Map<string,bigint>();
    for (const b of bets ?? []) { const type = String(b.selection?.type ?? ""); totals.set(type,(totals.get(type) ?? 0n)+BigInt(String(b.bet_amount))); }
    if (code === "dice") current.numberBetsAmount = Object.fromEntries([...totals].map(([k,v]) => [k,v.toString()]));
    if (code === "dragon_tiger") { current.dragonBetAmount=String(totals.get("dragon")??0n); current.tigerBetAmount=String(totals.get("tiger")??0n); current.tieBetAmount=String((totals.get("tie")??0n)+(totals.get("suited_tie")??0n)); }
    if (code === "andar_bahar") { current.andarBetAmount=String(totals.get("andar")??0n); current.baharBetAmount=String(totals.get("bahar")??0n); }
    const history = rounds.filter(r => r.status === "SETTLED").map(r => ({ roundNumber:Number(r.round_number), result:r.result, timestamp:r.settled_at }));
    return response({ round: current, history, bets: mappedBets, allBets: mappedBets }, 200, origin);
  }


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

  const auth = await actorFrom(req, db);
  if (!auth.actor) return response({ error: auth.error ?? "AUTH_REQUIRED" }, auth.status ?? 401, origin);
  const actor = auth.actor;

  // The old slider mode needs a dedicated atomic settlement contract. Fail closed
  // rather than treating its betAmount as an ordinary number bet.
  if (req.method === "POST" && path === "/games/dice/roll") {
    const candidate = await req.clone().json().catch(() => null);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate) &&
        ((candidate as Record<string, unknown>).mode === "slider" ||
         (candidate as Record<string, unknown>).betAmount !== undefined ||
         (candidate as Record<string, unknown>).target !== undefined ||
         (candidate as Record<string, unknown>).condition !== undefined)) {
      return response({ error: "DICE_SLIDER_MODE_NOT_MIGRATED", message: "Slider/target bets are disabled until atomic odds, liability reservation, and settlement are implemented." }, 503, origin);
    }
  }

  // Teen Patti's former implementation was process-memory based and is not safe
  // for financial play. Keep these routes explicitly unavailable until persistent
  // rounds, turn ownership, idempotency, and atomic wallet settlement exist.
  if (/^\/games\/teen-patti\/(state|boot|action)$/.test(path)) {
    return response({ error: "TEEN_PATTI_MIGRATION_NOT_READY" }, 503, origin);
  }

  // Persistent diagnostics endpoint. Only OWNER may read operational failure details.
  if (req.method === "GET" && path === "/monitoring/failures") {
    if (actor.role !== "OWNER") return response({ error: "OWNER_DIAGNOSTICS_AUTH_REQUIRED" }, 403, origin);
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, Math.floor(rawLimit))) : 100;
    const { data: events, error } = await db.schema("platform").from("system_health_events")
      .select("id,occurred_at,request_id,method,path,status_code,duration_ms,component,reason_code,reason,recovery")
      .order("occurred_at", { ascending: false }).limit(limit);
    if (error) return response({ error: "MONITORING_SERVICE_UNAVAILABLE" }, 503, origin);
    return response({
      events: (events ?? []).map((event) => ({
        id: event.id, occurredAt: event.occurred_at, requestId: event.request_id,
        method: event.method, path: event.path, statusCode: event.status_code,
        durationMs: event.duration_ms, component: event.component,
        reasonCode: event.reason_code, reason: event.reason, recovery: event.recovery,
      })),
      persistence: "database", capturedInMemoryLimit: 0,
      note: "Events are read from the persistent Supabase platform.system_health_events table.",
      timestamp: new Date().toISOString(),
    }, 200, origin);
  }

  if (req.method === "GET" && path === "/auth/me") {
    const { data: user, error } = await db.schema("platform").from("users")
      .select("id,username,email,parent_id,referred_by_user_id").eq("id", actor.id).maybeSingle();
    if (error || !user) return response({ error: "USER_NOT_FOUND_OR_DISABLED" }, 401, origin);
    const referral = await db.schema("platform").from("referral_codes").select("code")
      .eq("owner_user_id", actor.id).eq("is_active", true).limit(1);
    if (referral.error) return response({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503, origin);
    let wallet: Record<string, any> | null;
    try { wallet = await getWallet(db, actor); } catch { return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin); }
    return response({ user: safeUser({ ...user, role: actor.role, referral_code: referral.data?.[0]?.code ?? null }), wallet: walletShape(wallet) }, 200, origin);
  }

  if (req.method === "GET" && path === "/wallet/my-wallet") {
    try {
      const wallet = await getWallet(db, actor);
      if (!wallet) return response({ error: "WALLET_NOT_FOUND" }, 404, origin);
      return response({ wallet: walletShape(wallet) }, 200, origin);
    } catch { return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin); }
  }



  if (req.method === "POST" && path === "/auth/create-user") {
    const allowedRole = actor.role === "OWNER" ? ["SUPER_ADMIN"] : actor.role === "SUPER_ADMIN" ? ["ADMIN"] : actor.role === "ADMIN" ? ["PLAYER"] : [];
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = String(body.role ?? "");
    const initialTokens = body.initialTokens == null || body.initialTokens === "" ? "0" : String(body.initialTokens);
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 1024 || !allowedRole.includes(role) || !/^(0|[1-9][0-9]{0,14})$/.test(initialTokens)) return response({ error: allowedRole.length ? "INVALID_INPUT" : "ROLE_HIERARCHY_VIOLATION" }, allowedRole.length ? 400 : 403, origin);
    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await db.schema("platform").rpc("create_user_atomic", { p_actor_id:actor.id,p_username:username,p_email:email,p_password_hash:passwordHash,p_role:role,p_initial_tokens:initialTokens });
    if (error || !data?.user) {
      const message = error?.message ?? "";
      const code = message.includes("DUPLICATE_ACCOUNT") || message.includes("unique") ? "USERNAME_OR_EMAIL_ALREADY_REGISTERED" : message.includes("ROLE_HIERARCHY_VIOLATION") ? "ROLE_HIERARCHY_VIOLATION" : message.includes("INSUFFICIENT_FUNDS") ? "INSUFFICIENT_FUNDS" : "USER_CREATION_FAILED";
      return response({ error:code }, code === "USERNAME_OR_EMAIL_ALREADY_REGISTERED" ? 409 : code === "ROLE_HIERARCHY_VIOLATION" ? 403 : 400, origin);
    }
    return response(data,201,origin);
  }

  if (req.method === "GET" && path === "/auth/users") {
    if (actor.role === "PLAYER") return response({ error: "PLAYERS_CANNOT_LIST_USERS" }, 403, origin);
    const [userRows, roleRows, referralRows, walletRows] = await Promise.all([
      db.schema("platform").from("users").select("id,username,email,parent_id,is_active,created_at"),
      db.schema("platform").from("role_assignments").select("user_id,role"),
      db.schema("platform").from("referral_codes").select("owner_user_id,code").eq("is_active",true),
      db.schema("wallet").from("wallets").select("id,user_id,balance"),
    ]);
    if (userRows.error || roleRows.error || referralRows.error || walletRows.error) return response({ error: "USER_LIST_SERVICE_UNAVAILABLE" }, 503, origin);
    const roleMap = new Map((roleRows.data ?? []).map(r => [r.user_id,r.role]));
    const referralMap = new Map((referralRows.data ?? []).map(r => [r.owner_user_id,r.code]));
    const walletMap = new Map((walletRows.data ?? []).filter(w => w.user_id).map(w => [w.user_id,w]));
    const children = new Map<string, any[]>();
    for (const u of userRows.data ?? []) {
      if (!u.parent_id) continue;
      const arr = children.get(u.parent_id) ?? []; arr.push(u); children.set(u.parent_id,arr);
    }
    const descendants:any[] = []; const queue = [...(children.get(actor.id) ?? [])]; const seen = new Set<string>();
    while (queue.length) { const u = queue.shift(); if (!u || seen.has(u.id)) continue; seen.add(u.id);
      const w = walletMap.get(u.id); descendants.push({ id:u.id,username:u.username,email:u.email,parentId:u.parent_id,role:roleMap.get(u.id),isActive:u.is_active,referralCode:referralMap.get(u.id) ?? null,walletId:w?.id ?? null,walletBalance:w ? String(w.balance) : null });
      queue.push(...(children.get(u.id) ?? []));
    }
    return response({ users: descendants }, 200, origin);
  }

  if (req.method === "GET" && path === "/wallet/summary") {
    if (actor.role !== "OWNER") return response({ error: "OWNER_ONLY" }, 403, origin);
    const [supply, wallets, users] = await Promise.all([
      db.schema("wallet").from("token_supply").select("max_supply,total_minted").eq("id", 1).maybeSingle(),
      db.schema("wallet").from("wallets").select("wallet_type,balance,reserved_balance"),
      db.schema("platform").from("users").select("id", { count: "exact", head: true }),
    ]);
    if (supply.error || wallets.error || users.error || !supply.data) return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin);
    const total = (wallets.data ?? []).reduce((n, w) => n + BigInt(String(w.balance)), 0n);
    const sum = (type: string) => (wallets.data ?? []).filter(w => w.wallet_type === type).reduce((n,w) => n + BigInt(String(w.balance)), 0n);
    const treasury = sum("TREASURY"), pools = sum("GAME_POOL"), escrow = sum("ESCROW");
    const roleWallets = ["SUPER_ADMIN","ADMIN","PLAYER"].reduce((n,t) => n + sum(t), 0n);
    const valid = String(supply.data.max_supply) === String(supply.data.total_minted) && BigInt(String(supply.data.total_minted)) === total;
    return response({
      maxSupply: String(supply.data.max_supply), totalMinted: String(supply.data.total_minted),
      totalWalletBalance: total.toString(), treasuryBalance: treasury.toString(), gamePoolsBalance: pools.toString(),
      roleWalletsBalance: roleWallets.toString(), escrowBalance: escrow.toString(),
      userCount: users.count ?? 0, circulating: (total - treasury).toString(), totalCalculated: total.toString(),
      isSupplyValid: valid, invariantHolds: valid,
    }, 200, origin);
  }

  if (req.method === "GET" && path === "/wallet/ledger") {
    let query = db.schema("wallet").from("ledger_entries")
      .select("id,transaction_id,wallet_id,direction,amount,balance_after,description,created_at")
      .order("created_at", { ascending: false }).limit(actor.role === "OWNER" ? 100 : 50);
    if (actor.role !== "OWNER") {
      const { data: wallets, error } = await db.schema("wallet").from("wallets").select("id").eq("user_id", actor.id);
      if (error) return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin);
      query = query.in("wallet_id", (wallets ?? []).map(w => w.id));
    }
    const { data, error } = await query;
    if (error) return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin);
    return response({ entries: (data ?? []).map(row => ({
      id: row.id, transactionId: row.transaction_id, walletId: row.wallet_id, direction: row.direction,
      amount: String(row.amount), balanceAfter: String(row.balance_after), description: row.description, createdAt: row.created_at,
    })) }, 200, origin);
  }

  if (req.method === "POST" && path === "/wallet/transfer") {
    if (actor.role === "PLAYER") return response({ error: "PLAYERS_CANNOT_TRANSFER" }, 403, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const recipientId = String(body.recipientId ?? "");
    const amount = positiveAmount(body.amount);
    if (!recipientId || !amount) return response({ error: "INVALID_INPUT" }, 400, origin);
    const { data: recipient, error: recipientError } = await db.schema("platform").from("users")
      .select("id,parent_id,is_active").eq("id", recipientId).eq("is_active", true).maybeSingle();
    const { data: recipientRoles, error: recipientRoleError } = await db.schema("platform").from("role_assignments")
      .select("role").eq("user_id", recipientId).limit(2);
    if (recipientError || recipientRoleError) return response({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503, origin);
    if (!recipient || !recipientRoles || recipientRoles.length !== 1) return response({ error: "RECIPIENT_NOT_FOUND" }, 404, origin);
    const recipientRole = recipientRoles[0].role;
    const allowed = (actor.role === "OWNER" && recipientRole === "SUPER_ADMIN") ||
      (actor.role === "SUPER_ADMIN" && recipientRole === "ADMIN" && recipient.parent_id === actor.id) ||
      (actor.role === "ADMIN" && recipientRole === "PLAYER" && recipient.parent_id === actor.id);
    if (!allowed) return response({ error: "ROLE_HIERARCHY_VIOLATION" }, 403, origin);
    const source = await getWallet(db, actor);
    const { data: target, error: targetError } = await db.schema("wallet").from("wallets").select("id").eq("user_id", recipientId).maybeSingle();
    if (!source || !target || targetError) return response({ error: "WALLET_NOT_FOUND" }, 404, origin);
    const type = actor.role === "OWNER" ? "TREASURY_TO_ROLE" : actor.role === "SUPER_ADMIN" ? "ROLE_TO_ROLE" : "ROLE_TO_PLAYER";
    const key = req.headers.get("idempotency-key")?.trim() || `TRANSFER_${crypto.randomUUID()}`;
    if (key.length < 8 || key.length > 119 || !/^[A-Za-z0-9_-]+$/.test(key)) return response({ error: "INVALID_IDEMPOTENCY_KEY" }, 400, origin);
    const { data: transactionId, error: moveError } = await db.schema("wallet").rpc("wallet_transfer_atomic", {
      p_idempotency_key: key, p_type: type, p_amount: amount, p_source_wallet_id: source.id,
      p_target_wallet_id: target.id, p_metadata: { senderId: actor.id, recipientId, note: body.note ?? null },
    });
    if (moveError || !transactionId) {
      const message = moveError?.message ?? "";
      return response({ error: /INSUFFICIENT_FUNDS/i.test(message) ? "INSUFFICIENT_FUNDS" : "TRANSFER_FAILED" }, 400, origin);
    }
    try { await audit(db, actor.id, "DIRECT_TRANSFER", "WALLET", target.id, { amount, recipientId, transactionId }); }
    catch { /* Transfer is already durably committed; do not misreport it as failed. */ }
    const { data: balances } = await db.schema("wallet").from("wallets").select("id,balance").in("id", [source.id, target.id]);
    return response({ message: "TRANSFER_COMPLETED", transactionId, balances: (balances ?? []).map(b => ({ id: b.id, balance: String(b.balance) })) }, 200, origin);
  }

  const activationMatch = path.match(/^\/games\/(aviator|roulette|dice|dragon-tiger|andar-bahar)\/activate$/);
  if (req.method === "POST" && activationMatch) {
    if (actor.role !== "OWNER") return response({ error: "OWNER_ONLY" }, 403, origin);
    const code = activationMatch[1] === "dragon-tiger" ? "dragon_tiger"
      : activationMatch[1] === "andar-bahar" ? "andar_bahar" : activationMatch[1];
    // Only Aviator has a verified production round/settlement engine. Never
    // advertise another game as active until its scheduler and settlement path exist.
    if (code !== "aviator") return response({ error: "GAME_NOT_AVAILABLE_IN_PRODUCTION" }, 503, origin);
    const { data: game, error: gameError } = await db.schema("platform").from("games")
      .select("id,pool_wallet_id").eq("code", code).maybeSingle();
    if (gameError) return response({ error: "GAME_ACTIVATION_UNAVAILABLE" }, 503, origin);
    if (!game?.id || !game.pool_wallet_id) return response({ error: "GAME_POOL_WALLET_MISSING" }, 503, origin);
    const { data: pool, error: poolError } = await db.schema("wallet").from("wallets")
      .select("id,balance").eq("id", game.pool_wallet_id).maybeSingle();
    if (poolError) return response({ error: "GAME_ACTIVATION_UNAVAILABLE" }, 503, origin);
    const poolBalance = String(pool?.balance ?? "0");
    if (!pool || !/^[0-9]+$/.test(poolBalance) || BigInt(poolBalance) <= 0n) {
      return response({ error: "ALLOCATE_GAME_POOL_TOKENS_FIRST" }, 400, origin);
    }
    const { error: updateError } = await db.schema("platform").from("games")
      .update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("code", code);
    if (updateError) return response({ error: "GAME_ACTIVATION_FAILED" }, 503, origin);
    try {
      await audit(db, actor.id, "GAME_ACTIVATED", "GAME", game.id, { gameCode: code, poolBalance });
    } catch {
      // Activation is already persisted. Keep the API response explicit rather
      // than reporting failure and encouraging an unsafe repeated allocation.
      console.error("Game activation audit write failed.");
    }
    return response({ status: "ACTIVE", gameCode: code, poolBalance }, 200, origin);
  }

  if (req.method === "GET" && path === "/games/list") {
    const { data, error } = await db.schema("platform").from("games")
      .select("id,code,name,status,min_bet,max_bet,config").order("name");
    if (error) return response({ error: "GAME_SERVICE_UNAVAILABLE" }, 503, origin);
    return response({ games: data ?? [] }, 200, origin);
  }

  if (req.method === "POST" && path === "/wallet/game-pool") {
    if (actor.role !== "OWNER") return response({ error: "OWNER_ONLY" }, 403, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const gameCode = String(body.gameCode ?? "aviator").trim();
    const amount = positiveAmount(body.amount);
    if (!["aviator","roulette","dice","dragon_tiger","andar_bahar"].includes(gameCode)) return response({ error: "UNKNOWN_GAME" }, 400, origin);
    if (!amount) return response({ error: "POSITIVE_SAFE_INTEGER_AMOUNT_REQUIRED" }, 400, origin);
    const key = req.headers.get("idempotency-key")?.trim() ?? "";
    if (key.length < 8 || key.length > 119 || !/^[A-Za-z0-9_-]+$/.test(key)) return response({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400, origin);
    const source = await db.schema("wallet").from("wallets").select("id").eq("wallet_type","TREASURY").maybeSingle();
    const pool = await db.schema("platform").from("game_pools").select("wallet_id").eq("game_code",gameCode).maybeSingle();
    if (source.error || pool.error || !source.data || !pool.data) return response({ error: "GAME_POOL_NOT_FOUND" }, 404, origin);
    const { data: transactionId, error } = await db.schema("wallet").rpc("wallet_transfer_atomic", {
      p_idempotency_key: key, p_type: "POOL_ALLOCATION", p_amount: amount, p_source_wallet_id: source.data.id,
      p_target_wallet_id: pool.data.wallet_id, p_metadata: { gameCode, allocatedBy: actor.id },
    });
    if (error || !transactionId) return response({ error: /INSUFFICIENT_FUNDS/i.test(error?.message ?? "") ? "INSUFFICIENT_FUNDS" : "POOL_ALLOCATION_FAILED" }, 400, origin);
    return response({ transactionId, amount, gameCode }, 200, origin);
  }

  const activate = path.match(/^\/games\/([^/]+)\/activate$/);
  if (req.method === "POST" && activate) {
    if (actor.role !== "OWNER") return response({ error: "OWNER_ONLY" }, 403, origin);
    const gameCode = decodeURIComponent(activate[1]).replace(/-/g, "_");
    const pool = await db.schema("platform").from("game_pools").select("wallet_id").eq("game_code", gameCode).maybeSingle();
    if (pool.error || !pool.data) return response({ error: "GAME_POOL_NOT_FOUND" }, 404, origin);
    const { data: wallet, error: walletError } = await db.schema("wallet").from("wallets").select("balance,reserved_balance").eq("id", pool.data.wallet_id).maybeSingle();
    if (walletError || !wallet) return response({ error: "GAME_POOL_NOT_FOUND" }, 404, origin);
    const { error } = await db.schema("platform").from("games").update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("code", gameCode);
    if (error) return response({ error: "GAME_ACTIVATION_FAILED" }, 400, origin);
    return response({ status: "ACTIVE", gameCode, poolBalance: String(wallet.balance), reservedBalance: String(wallet.reserved_balance) }, 200, origin);
  }

  if (req.method === "GET" && path === "/games/aviator/state") {
    const { data: rounds, error } = await db.schema("aviator").from("game_rounds")
      .select("id,game_code,round_number,status,crash_multiplier,started_at,ended_at,server_seed_hash,revealed_server_seed")
      .eq("game_code","aviator").order("round_number", { ascending: false }).limit(25);
    if (error) return response({ error: "GAME_SERVICE_UNAVAILABLE" }, 503, origin);
    const row = (rounds ?? []).find(r => r.status === "RUNNING" || r.status === "WAITING") ?? (rounds ?? [])[0] ?? null;
    const history = (rounds ?? []).filter(r => r.status === "CRASHED" || r.status === "SETTLED").map(r => ({
      roundNumber: Number(r.round_number), crashMultiplier: Number(r.crash_multiplier ?? 0), endedAt: r.ended_at,
      serverSeedHash: r.server_seed_hash, revealedServerSeed: r.revealed_server_seed,
    }));
    if (!row) return response({ round: null, bets: [], history }, 200, origin);
    const elapsedSeconds = Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000);
    const liveMultiplier = Math.floor(Math.exp(0.06 * Math.pow(elapsedSeconds, 1.15)) * 100) / 100;
    const crashed = ["CRASHED","SETTLED"].includes(row.status);
    const multiplier = row.status === "RUNNING" ? Math.min(liveMultiplier, Number(row.crash_multiplier ?? liveMultiplier)) : crashed ? Number(row.crash_multiplier ?? 1) : 1;
    const { data: betRows, error: betError } = await db.schema("aviator").from("game_bets")
      .select("id,round_id,bet_amount,auto_cashout,status,payout_amount,cashed_out_at,user_id")
      .eq("round_id",row.id).order("created_at",{ascending:false}).limit(100);
    if (betError) return response({ error: "GAME_STORAGE_UNAVAILABLE" }, 503, origin);
    const ids = [...new Set((betRows ?? []).map(b => b.user_id))];
    const { data: userRows } = ids.length ? await db.schema("platform").from("users").select("id,username").in("id",ids) : { data: [] };
    const names = new Map((userRows ?? []).map(u => [u.id,u.username]));
    const bets = (betRows ?? []).map(b => ({ id:b.id, roundId:b.round_id, betAmount:String(b.bet_amount), autoCashout:b.auto_cashout, status:b.status, payoutAmount:String(b.payout_amount ?? 0), cashedOutAt:b.cashed_out_at, username:names.get(b.user_id) ?? "Player" }));
    const current = { id:row.id, roundNumber:Number(row.round_number), status:row.status, startedAt:row.started_at, endedAt:row.ended_at, multiplier, crashMultiplier:crashed ? row.crash_multiplier : null, serverSeedHash:row.server_seed_hash, revealedServerSeed:row.revealed_server_seed };
    return response({ round: current, bets, history }, 200, origin);
  }


  if (req.method === "GET" && path === "/games/aviator/history") {
    const { data, error } = await db.schema("aviator").from("game_rounds")
      .select("round_number,crash_multiplier,ended_at,server_seed_hash,revealed_server_seed")
      .eq("game_code","aviator").in("status",["CRASHED","SETTLED"]).order("round_number",{ascending:false}).limit(20);
    if (error) return response({ error: "GAME_STORAGE_UNAVAILABLE" }, 503, origin);
    return response({ history: (data ?? []).map(r => ({ roundNumber:Number(r.round_number), crashMultiplier:r.crash_multiplier == null ? null : Number(r.crash_multiplier), endedAt:r.ended_at, serverSeedHash:r.server_seed_hash, revealedServerSeed:r.revealed_server_seed })) }, 200, origin);
  }

  if (req.method === "POST" && path === "/games/aviator/cashout") {
    if (actor.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const betId = String(body.betId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(betId)) return response({ error: "INVALID_BET_ID" }, 400, origin);
    const key = req.headers.get("idempotency-key")?.trim() || `CASHOUT_${betId.replace(/-/g,"")}`;
    const { data, error } = await db.schema("aviator").rpc("cashout_crash_bet_atomic", {
      p_user_id: actor.id, p_bet_id: betId, p_idempotency_key: key,
    });
    if (error || !data) return response({ error: /ALREADY|CASHOUT/i.test(error?.message ?? "") ? "BET_ALREADY_CASHED_OUT_OR_UNAVAILABLE" : "CASHOUT_REJECTED" }, 409, origin);
    return response({ result: data }, 200, origin);
  }

  if (req.method === "GET" && path === "/requests/list") {
    const { data, error } = await db.schema("platform").from("token_requests")
      .select("id,requester_id,approver_id,amount,status,requester_note,decision_note,created_at,resolved_at")
      .or(`requester_id.eq.${actor.id},approver_id.eq.${actor.id}`).order("created_at", { ascending: false }).limit(200);
    if (error) return response({ error: "REQUEST_SERVICE_UNAVAILABLE" }, 503, origin);
    return response({ requests: (data ?? []).map(r => ({
      id:r.id, requesterId:r.requester_id, approverId:r.approver_id, amount:String(r.amount), status:r.status,
      note:r.requester_note, decisionNote:r.decision_note, createdAt:r.created_at, resolvedAt:r.resolved_at,
    })) }, 200, origin);
  }

  if (req.method === "POST" && path === "/requests/create") {
    if (actor.role === "OWNER") return response({ error: "OWNER_DOES_NOT_REQUEST_TOKENS" }, 400, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const amount = positiveAmount(body.amount);
    if (!amount) return response({ error: "INVALID_AMOUNT" }, 400, origin);
    if (!actor.parentId) return response({ error: "APPROVER_NOT_CONFIGURED" }, 400, origin);
    const { data, error } = await db.schema("platform").from("token_requests").insert({
      requester_id: actor.id, approver_id: actor.parentId, amount, status: "PENDING", requester_note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
    }).select("id,requester_id,approver_id,amount,status,requester_note,created_at").single();
    if (error || !data) return response({ error: "TOKEN_REQUEST_CREATION_FAILED" }, 400, origin);
    try { await audit(db, actor.id, "TOKEN_REQUEST_CREATED", "TOKEN_REQUEST", data.id, { amount, approverId: actor.parentId }); } catch {}
    return response({ request: { id:data.id, requesterId:data.requester_id, approverId:data.approver_id, amount:String(data.amount), status:data.status, note:data.requester_note, createdAt:data.created_at } }, 201, origin);
  }


  const requestResolution = path.match(/^\/requests\/([^/]+)\/(approve|reject)$/);
  if (req.method === "POST" && requestResolution) {
    if (actor.role === "PLAYER") return response({ error: requestResolution[2] === "approve" ? "PLAYER_CANNOT_APPROVE_REQUESTS" : "PLAYER_CANNOT_REJECT_REQUESTS" }, 403, origin);
    const requestId = requestResolution[1];
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return response({ error: "REQUEST_NOT_FOUND" }, 404, origin);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const note = typeof body.decisionNote === "string" ? body.decisionNote.slice(0,500) : null;
    const { data, error } = await db.schema("platform").rpc("resolve_token_request_atomic", {
      p_request_id: requestId, p_actor_id: actor.id, p_action: requestResolution[2] === "approve" ? "APPROVE" : "REJECT", p_note: note,
    });
    if (error || !data) {
      const message = error?.message ?? "";
      const known = ["NOT_ASSIGNED_APPROVER","ROLE_HIERARCHY_VIOLATION","PLAYER_CANNOT_RESOLVE_REQUESTS","REQUEST_NOT_FOUND","REQUEST_ALREADY_RESOLVED","INSUFFICIENT_FUNDS","WALLET_NOT_FOUND"];
      const code = known.find(x => message.includes(x));
      const status = code === "NOT_ASSIGNED_APPROVER" || code === "ROLE_HIERARCHY_VIOLATION" || code === "PLAYER_CANNOT_RESOLVE_REQUESTS" ? 403 :
        code === "REQUEST_NOT_FOUND" ? 404 : code === "REQUEST_ALREADY_RESOLVED" ? 409 : 400;
      return response({ error: code ?? "TOKEN_REQUEST_RESOLUTION_FAILED" }, status, origin);
    }
    return response(data, 200, origin);
  }

  if (req.method === "GET" && path === "/audit/logs") {
    if (actor.role !== "OWNER") return response({ error: "OWNER_ONLY" }, 403, origin);
    const { data, error } = await db.schema("platform").from("audit_logs")
      .select("id,actor_id,action,target_type,target_id,details,ip_address,created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) return response({ error: "AUDIT_SERVICE_UNAVAILABLE" }, 503, origin);
    return response({ logs: data ?? [] }, 200, origin);
  }


  const gameBetMatch = path.match(/^\/games\/(roulette|dice|dragon-tiger|andar-bahar)\/(bet|spin|roll)$/);
  if (req.method === "POST" && gameBetMatch) {
    if (actor.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
    const code = gameBetMatch[1] === "dragon-tiger" ? "dragon_tiger" : gameBetMatch[1] === "andar-bahar" ? "andar_bahar" : gameBetMatch[1];
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "INVALID_JSON" }, 400, origin);
    const bets = Array.isArray(body.bets) ? body.bets : [body];
    if (!bets.length || bets.length > 20 || bets.some((b:any) => !positiveAmount(b?.amount))) return response({ error: "INVALID_BET" }, 400, origin);
    const key = req.headers.get("idempotency-key")?.trim() || String(body.idempotencyKey ?? "");
    if (key.length < 8 || key.length > 110 || !/^[A-Za-z0-9_-]+$/.test(key)) return response({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400, origin);
    const { data, error } = await db.schema("platform").rpc("place_authoritative_game_bets_atomic", {
      p_game_code: code, p_user_id: actor.id, p_bets: bets, p_idempotency_key: key,
    });
    if (error || !data) {
      const message = error?.message ?? "";
      const known = ["BETTING_CLOSED","GAME_NOT_CONFIGURED","GAME_WALLETS_NOT_CONFIGURED","GAME_POOL_INSUFFICIENT","BET_OUT_OF_RANGE","IDEMPOTENCY_KEY_REUSE","PLAYER_NOT_ACTIVE"];
      const match = known.find(x => message.includes(x));
      const status = match === "BETTING_CLOSED" ? 409 : match === "GAME_NOT_CONFIGURED" || match === "GAME_WALLETS_NOT_CONFIGURED" ? 503 : match === "PLAYER_NOT_ACTIVE" ? 403 : 400;
      return response({ error: match ?? "BET_PLACEMENT_FAILED" }, status, origin);
    }
    const state = await db.schema(code).from("authoritative_game_rounds").select("id,round_number,status,state,betting_closes_at,opened_at,result,server_seed_hash,server_seed").eq("id", data.roundId).maybeSingle();
    return response({ ...data, ...(state.data ? { round: { id:state.data.id,roundNumber:Number(state.data.round_number),status:state.data.status,state:state.data.state,bettingEndsAt:new Date(state.data.betting_closes_at).getTime(),openedAt:new Date(state.data.opened_at).getTime(),result:state.data.status === "SETTLED" ? state.data.result : null,serverSeedHash:state.data.server_seed_hash,revealedServerSeed:state.data.status === "SETTLED" ? state.data.server_seed : null } } : {}) }, data.replay ? 200 : 201, origin);
  }


  if (req.method === "GET" && path === "/auth/admin-payment-info") {
    const targetId = actor.role === "PLAYER" ? actor.parentId : actor.id;
    if (!targetId) return response({ upiId:"", upiQrCode:"", paymentAccountName:"" },200,origin);
    const { data,error } = await db.schema("platform").from("user_profiles").select("preferences").eq("user_id",targetId).maybeSingle();
    if (error) return response({ error:"PAYMENT_INFO_UNAVAILABLE" },503,origin);
    const p = data?.preferences ?? {};
    return response({ upiId:p.upiId ?? "", upiQrCode:p.upiQrCode ?? "", paymentAccountName:p.paymentAccountName ?? "" },200,origin);
  }
  if (req.method === "PUT" && path === "/auth/payment-details") {
    if (!["OWNER","SUPER_ADMIN","ADMIN"].includes(actor.role)) return response({ error:"ADMIN_ONLY" },403,origin);
    let body: Record<string,unknown>;
    try { body = await req.json(); } catch { return response({ error:"INVALID_JSON" },400,origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error:"INVALID_JSON" },400,origin);
    const upiId = typeof body.upiId === "string" ? body.upiId.trim().slice(0,120) : undefined;
    const upiQrCode = typeof body.upiQrCode === "string" ? body.upiQrCode.slice(0,500000) : undefined;
    const paymentAccountName = typeof body.paymentAccountName === "string" ? body.paymentAccountName.trim().slice(0,120) : undefined;
    if (upiId === undefined && upiQrCode === undefined && paymentAccountName === undefined) return response({ error:"NO_PAYMENT_FIELDS" },400,origin);
    const { data:profile,error:readError } = await db.schema("platform").from("user_profiles").select("preferences").eq("user_id",actor.id).maybeSingle();
    if (readError || !profile) return response({ error:"PAYMENT_INFO_UNAVAILABLE" },503,origin);
    const preferences = { ...(profile.preferences ?? {}), ...(upiId !== undefined ? {upiId} : {}), ...(upiQrCode !== undefined ? {upiQrCode} : {}), ...(paymentAccountName !== undefined ? {paymentAccountName} : {}) };
    const { error } = await db.schema("platform").from("user_profiles").update({ preferences,updated_at:new Date().toISOString() }).eq("user_id",actor.id);
    if (error) return response({ error:"PAYMENT_INFO_UPDATE_FAILED" },400,origin);
    try { await audit(db,actor.id,"PAYMENT_DETAILS_UPDATED","USER",actor.id,{ fields:[upiId !== undefined ? "upiId" : null,upiQrCode !== undefined ? "upiQrCode" : null,paymentAccountName !== undefined ? "paymentAccountName" : null].filter(Boolean) }); } catch {}
    return response({ message:"PAYMENT_DETAILS_UPDATED",user:{id:actor.id,username:actor.username,role:actor.role} },200,origin);
  }

  if (/^\/games\/(roulette|dice|dragon-tiger|andar-bahar|teen-patti)(\/|$)/.test(path)) {
    return response({ error: "GAME_NOT_AVAILABLE_IN_PRODUCTION" }, 503, origin);
  }
  if (path === "/auth/register-referral" || path === "/auth/create-user" || path === "/auth/users" ||
      path === "/auth/admin-payment-info" || path === "/auth/payment-details" ||
      /^\/requests\/[^/]+\/(approve|reject)$/.test(path)) {
    return response({ error: "MIGRATION_NOT_READY" }, 503, origin);
  }
  return response({ error: "NOT_FOUND" }, 404, origin);
}

async function recordEdgeFailure(req: Request, statusCode: number, durationMs: number) {
  try {
    const db = client();
    const path = new URL(req.url).pathname.slice(0, 180);
    const component = /wallet|transfer|ledger/i.test(path) ? "Wallet API"
      : /auth|login|register/i.test(path) ? "Authentication"
      : /games|aviator|bet|cashout|round|settle/i.test(path) ? "Game / Settlement"
      : "Backend API / Database";
    const { error } = await db.schema("platform").from("system_health_events").insert({
      id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      request_id: (req.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 80),
      method: req.method.slice(0, 12),
      path,
      status_code: statusCode,
      duration_ms: Math.max(0, Math.round(durationMs)),
      component,
      reason_code: statusCode === 500 ? "EDGE_API_INTERNAL_ERROR" : "EDGE_API_UNAVAILABLE",
      reason: "Supabase Edge API returned an HTTP 5xx response; request payloads and credentials are not recorded.",
      recovery: "Inspect the matching Edge Function log and database connectivity; verify wallet/game idempotency before retrying any financial action.",
    });
    if (error) console.error("Could not persist Edge API health event:", error.code ?? "unknown");
  } catch (error) {
    console.error("Could not persist Edge API health event:", error instanceof Error ? error.message : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  try {
    const result = await handle(req);
    if (result.status >= 500) await recordEdgeFailure(req, result.status, Date.now() - startedAt);
    return result;
  } catch (error) {
    console.error("Supabase API request failed:", error instanceof Error ? error.message : "unknown");
    const message = error instanceof Error ? error.message : "";
    const status = message === "SERVER_CONFIGURATION_ERROR" ? 500 : 503;
    await recordEdgeFailure(req, status, Date.now() - startedAt);
    return response({ error: status === 500 ? "SERVER_CONFIGURATION_ERROR" : "API_SERVICE_UNAVAILABLE" }, status, req.headers.get("origin"));
  }
});
