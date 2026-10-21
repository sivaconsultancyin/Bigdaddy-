import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import bcrypt from "npm:bcryptjs@2.4.3";
import { corsHeaders, jsonResponse, signBigDaddyToken } from "../_shared/bigdaddy-jwt.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse({ error: "INVALID_JSON" }, 400); }
  if (!body || typeof body !== "object") return jsonResponse({ error: "INVALID_INPUT" }, 400);
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== "string" || username.trim().length < 3 ||
      typeof password !== "string" || password.length < 1 || password.length > 1024) {
    return jsonResponse({ error: "INVALID_USERNAME_OR_PASSWORD" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey || !Deno.env.get("BIGDADDY_JWT_SECRET")) {
    console.error("Auth function server secrets are not configured.");
    return jsonResponse({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Keep the existing BigDaddy account store and role hierarchy.
    const { data: user, error: userError } = await supabase
      .schema("platform")
      .from("users")
      .select("id,username,email,password_hash,parent_id,referred_by_user_id,is_active")
      .ilike("username", username.trim())
      .limit(2);
    if (userError) {
      console.error("Login user lookup failed:", userError.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }
    if (!user || user.length !== 1 || !user[0].is_active) {
      return jsonResponse({ error: "INVALID_USERNAME_OR_PASSWORD" }, 401);
    }
    const account = user[0];
    const passwordOk = await bcrypt.compare(password, account.password_hash);
    if (!passwordOk) return jsonResponse({ error: "INVALID_USERNAME_OR_PASSWORD" }, 401);

    const { data: roleRows, error: roleError } = await supabase
      .schema("platform")
      .from("role_assignments")
      .select("role")
      .eq("user_id", account.id)
      .limit(2);
    if (roleError || !roleRows || roleRows.length !== 1) {
      console.error("Login role lookup failed:", roleError?.code ?? "invalid_role_assignment");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }
    const role = roleRows[0].role;
    if (!["OWNER", "SUPER_ADMIN", "ADMIN", "PLAYER"].includes(role)) {
      return jsonResponse({ error: "INVALID_ACCOUNT_ROLE" }, 403);
    }

    const walletQuery = supabase.schema("wallet").from("wallets")
      .select("id,user_id,wallet_type,balance,reserved_balance,game_code,created_at,updated_at");
    const { data: wallets, error: walletError } = role === "OWNER"
      ? await walletQuery.eq("wallet_type", "TREASURY").limit(1)
      : await walletQuery.eq("user_id", account.id).limit(1);
    if (walletError) {
      console.error("Login wallet lookup failed:", walletError.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }

    const token = await signBigDaddyToken({
      id: account.id,
      username: account.username,
      role,
      parentId: account.parent_id ?? null,
    });
    const referralResult = await supabase.schema("platform").from("referral_codes")
      .select("code").eq("owner_user_id", account.id).eq("is_active", true).limit(1);
    if (referralResult.error) {
      console.error("Login referral lookup failed:", referralResult.error.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }

    const auditResult = await supabase.schema("platform").from("audit_logs").insert({
      actor_id: account.id,
      action: "USER_LOGIN",
      target_type: "USER",
      target_id: account.id,
      details: { source: "supabase-edge-function" },
    });
    if (auditResult.error) {
      console.error("Login audit insert failed:", auditResult.error.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }

    const safeUser = {
      id: account.id,
      username: account.username,
      email: account.email,
      role,
      parentId: account.parent_id ?? null,
      referredBy: account.referred_by_user_id ?? null,
      referralCode: referralResult.data?.[0]?.code ?? null,
    };
    const wallet = wallets?.[0] ? {
      id: wallets[0].id,
      userId: wallets[0].user_id,
      walletType: wallets[0].wallet_type,
      balance: String(wallets[0].balance ?? "0"),
      reservedBalance: String(wallets[0].reserved_balance ?? "0"),
      gameCode: wallets[0].game_code,
      createdAt: wallets[0].created_at,
      updatedAt: wallets[0].updated_at,
    } : null;
    return jsonResponse({ token, user: safeUser, wallet });
  } catch (error) {
    console.error("Login function failed:", error instanceof Error ? error.message : "unknown");
    return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
  }
});
