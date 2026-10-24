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
  if (req.method === "POST" && path === "/games/aviator/bet") {
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
  }

  if (req.method === "GET" && (path === "/games/aviator/state" || path === "/games/aviator/history")) {
    const auth = await actorFrom(req, db);
    if (!auth.actor) {
      if (req.method === "GET" && path === "/games/aviator/state") {
        console.error(JSON.stringify({ event: "aviator_state_api_timing", httpStatus: auth.status ?? 401, totalMs: Math.round(performance.now() - requestStartedAt), errorCode: auth.error ?? "AUTH_REQUIRED" }));
      }
      return response({ error: auth.error ?? "AUTH_REQUIRED" }, auth.status ?? 401, origin);
    }
  }

    if (req.method === "GET" && path === "/games/aviator/state") {
        console.error(JSON.stringify({
          event: "aviator_state_api_timing",
          httpStatus: auth.status ?? 401,
          totalMs: Math.round(performance.now() - requestStartedAt),
          errorCode: auth.error ?? "AUTH_REQUIRED",
        }));
      }
      return response({ error: auth.error ?? "AUTH_REQUIRED" }, auth.status ?? 401, origin);
    }
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
      // Roulette now has a persisted PostgreSQL round lifecycle and atomic settlement.
      // Keep games without a verified production engine blocked.
      if (code !== "aviator" && code !== "roulette") {
        return response({ error: "GAME_NOT_AVAILABLE_IN_PRODUCTION" }, 503, origin);
      }
      const { data: game, error: gameError } = await db.schema("platform").from("games")
        .select("id,status,pool_wallet_id").eq("code", code).maybeSingle();
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
      // Smoke-test Roulette's durable lifecycle before confirming activation. If the
      // lifecycle RPC is missing or cannot create/read the first round, roll back a
      // newly activated game instead of leaving the UI advertising a broken game.
      if (code === "roulette") {
        const { data: runtimeState, error: runtimeError } = await db.schema("roulette").rpc("advance_round");
        if (runtimeError || !runtimeState || runtimeState.gameStateUnavailable || !runtimeState.round?.id) {
          if (game.status !== "ACTIVE") {
            await db.schema("platform").from("games").update({
              status: "COMING_SOON", updated_at: new Date().toISOString(),
            }).eq("code", code).eq("status", "ACTIVE");
          }
          console.error("Roulette activation runtime check failed:", runtimeError?.code ?? "unavailable");
          return response({ error: "ROULETTE_RUNTIME_UNAVAILABLE" }, 503, origin);
        }
      }
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
