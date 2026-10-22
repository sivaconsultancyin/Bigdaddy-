import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse, verifyBigDaddyToken } from "./bigdaddy-jwt.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "AUTH_REQUIRED" }, 401);
  const claims = await verifyBigDaddyToken(authorization.slice(7).trim());
  if (!claims) return jsonResponse({ error: "INVALID_TOKEN" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("Auth-me function server secrets are not configured.");
    return jsonResponse({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: user, error: userError } = await supabase.schema("platform").from("users")
      .select("id,username,email,parent_id,referred_by_user_id,is_active")
      .eq("id", claims.id).eq("is_active", true).maybeSingle();
    if (userError) {
      console.error("Auth-me user lookup failed:", userError.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }
    if (!user) return jsonResponse({ error: "USER_NOT_FOUND_OR_DISABLED" }, 401);

    const { data: roles, error: roleError } = await supabase.schema("platform").from("role_assignments")
      .select("role").eq("user_id", user.id).limit(2);
    if (roleError || !roles || roles.length !== 1) {
      console.error("Auth-me role lookup failed:", roleError?.code ?? "invalid_role_assignment");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }
    const role = roles[0].role;
    if (role !== claims.role) return jsonResponse({ error: "TOKEN_ROLE_STALE" }, 401);

    const walletQuery = supabase.schema("wallet").from("wallets")
      .select("id,user_id,wallet_type,balance,reserved_balance,game_code,created_at,updated_at");
    const { data: wallets, error: walletError } = role === "OWNER"
      ? await walletQuery.eq("wallet_type", "TREASURY").limit(1)
      : await walletQuery.eq("user_id", user.id).limit(1);
    if (walletError) {
      console.error("Auth-me wallet lookup failed:", walletError.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }
    const referral = await supabase.schema("platform").from("referral_codes")
      .select("code").eq("owner_user_id", user.id).eq("is_active", true).limit(1);
    if (referral.error) {
      console.error("Auth-me referral lookup failed:", referral.error.code ?? "unknown");
      return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      role,
      parentId: user.parent_id ?? null,
      referredBy: user.referred_by_user_id ?? null,
      referralCode: referral.data?.[0]?.code ?? null,
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
    return jsonResponse({ user: safeUser, wallet });
  } catch (error) {
    console.error("Auth-me function failed:", error instanceof Error ? error.message : "unknown");
    return jsonResponse({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
  }
});
