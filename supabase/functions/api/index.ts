import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import bcrypt from "npm:bcryptjs@2.4.3";
import { corsHeaders, jsonResponse, signBigDaddyToken, verifyBigDaddyToken, type BigDaddyClaims } from "./bigdaddy-jwt.ts";

type Role = "OWNER" | "SUPER_ADMIN" | "ADMIN" | "PLAYER";
type Actor = BigDaddyClaims & { parentId: string | null };
const roles: Role[] = ["OWNER", "SUPER_ADMIN", "ADMIN", "PLAYER"];

function response(body: Record<string, unknown>, status = 200, origin?: string | null) {
  const headers = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };
  const allowed = (Deno.env.get("BIGDADDY_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.length && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
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
\nasync function handle(req: Request) {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/api(?=\/|$)/, "").replace(/^\/api(?=\/)/, "").replace(/\/$/, "") || "/";
  if (req.method === "GET" && path === "/health") return response({ status: "ok", service: "BigDaddy Supabase API", database: "supabase-https" }, 200, origin);
  if (req.method === "GET" && path === "/ready") return response({ ready: true, database: "supabase-https" }, 200, origin);
  if (req.method === "GET" && path === "/config") {
    return response({
      mode: "production", currency: "tokens", apiBackend: "supabase",
      games: ["aviator", "roulette", "dice", "dragon_tiger", "andar_bahar"],
    }, 200, origin);
  }
  let db: SupabaseClient;
  try { db = client(); } catch { return response({ error: "SERVER_CONFIGURATION_ERROR" }, 500, origin); }

  // Public login: same BigDaddy HS256 token contract as the existing backend.
  if (req.method === "POST" && path === "/auth/login") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || password.length < 1 || password.length > 1024) {
      return response({ error: "INVALID_USERNAME_OR_PASSWORD" }, 400, origin);
    }
    const { data: users, error: userError } = await db.schema("platform").from("users")
      .select("id,username,email,password_hash,parent_id,referred_by_user_id,is_active")
      .ilike("username", username).limit(2);
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

  const auth = await actorFrom(req, db);
  if (!auth.actor) return response({ error: auth.error ?? "AUTH_REQUIRED" }, auth.status ?? 401, origin);
  const actor = auth.actor;

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
    const gameCode = decodeURIComponent(activate[1]);
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
      .order("round_number", { ascending: false }).limit(25);
    if (error) return response({ error: "GAME_SERVICE_UNAVAILABLE" }, 503, origin);
    const current = (rounds ?? []).find(r => r.status === "RUNNING" || r.status === "WAITING") ?? (rounds ?? [])[0] ?? null;
    const history = (rounds ?? []).filter(r => r.status === "CRASHED" || r.status === "SETTLED").map(r => ({
      roundNumber: Number(r.round_number), crashMultiplier: Number(r.crash_multiplier ?? 0), endedAt: r.ended_at,
    }));
    return response({ round: current, history, state: current }, 200, origin);
  }

  if (req.method === "POST" && path === "/games/aviator/bet") {
    if (actor.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
    const amount = positiveAmount(body.amount);
    const autoCashout = body.autoCashoutMultiplier == null ? null : Number(body.autoCashoutMultiplier);
    if (!amount || (autoCashout !== null && (!Number.isFinite(autoCashout) || autoCashout < 1.01 || autoCashout > 1000))) {
      return response({ error: "INVALID_BET" }, 400, origin);
    }
    const key = req.headers.get("idempotency-key")?.trim() ?? "";
    if (key.length < 8 || key.length > 119 || !/^[A-Za-z0-9_-]+$/.test(key)) return response({ error: "INVALID_IDEMPOTENCY_KEY" }, 400, origin);
    const { data: round, error: roundError } = await db.schema("aviator").from("game_rounds").select("id,status")
      .eq("status", "WAITING").order("round_number", { ascending: false }).limit(1).maybeSingle();
    if (roundError || !round) return response({ error: "NO_OPEN_ROUND" }, 409, origin);
    const { data: betId, error } = await db.schema("aviator").rpc("place_crash_bet_atomic", {
      p_user_id: actor.id, p_round_id: round.id, p_amount: amount, p_idempotency_key: key, p_auto_cashout: autoCashout,
    });
    if (error || !betId) return response({ error: /INSUFFICIENT_FUNDS/i.test(error?.message ?? "") ? "INSUFFICIENT_FUNDS" : "BET_REJECTED" }, 400, origin);
    return response({ betId, roundId: round.id, amount, status: "PENDING" }, 201, origin);
  }

  if (req.method === "POST" && path === "/games/aviator/cashout") {
    if (actor.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
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

  if (req.method === "GET" && path === "/audit/logs") {
    if (actor.role !== "OWNER") return response({ error: "OWNER_ONLY" }, 403, origin);
    const { data, error } = await db.schema("platform").from("audit_logs")
      .select("id,actor_id,action,target_type,target_id,details,ip_address,created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) return response({ error: "AUDIT_SERVICE_UNAVAILABLE" }, 503, origin);
    return response({ logs: data ?? [] }, 200, origin);
  }


  const gameStateMatch = path.match(/^\\/games\\/(roulette|dice|dragon-tiger|andar-bahar)\\/state$/);
  if (req.method === "GET" && gameStateMatch) {
    const code = gameStateMatch[1] === "dragon-tiger" ? "dragon_tiger" : gameStateMatch[1] === "andar-bahar" ? "andar_bahar" : gameStateMatch[1];
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

  const gameBetMatch = path.match(/^\\/games\\/(roulette|dice|dragon-tiger|andar-bahar)\\/(bet|spin|roll)$/);
  if (req.method === "POST" && gameBetMatch) {
    if (actor.role !== "PLAYER") return response({ error: "PLAYER_ONLY" }, 403, origin);
    const code = gameBetMatch[1] === "dragon-tiger" ? "dragon_tiger" : gameBetMatch[1] === "andar-bahar" ? "andar_bahar" : gameBetMatch[1];
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return response({ error: "INVALID_JSON" }, 400, origin); }
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

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error("Supabase API request failed:", error instanceof Error ? error.message : "unknown");
    const message = error instanceof Error ? error.message : "";
    const status = message === "SERVER_CONFIGURATION_ERROR" ? 500 : 503;
    return response({ error: status === 500 ? "SERVER_CONFIGURATION_ERROR" : "API_SERVICE_UNAVAILABLE" }, status, req.headers.get("origin"));
  }
});
