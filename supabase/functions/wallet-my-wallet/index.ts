import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse, verifyBigDaddyToken } from "../auth-me/bigdaddy-jwt.ts";

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
    console.error("Wallet function server secrets are not configured.");
    return jsonResponse({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Revalidate account and role in the database; never trust JWT role claims alone.
    const { data: user, error: userError } = await supabase.schema("platform").from("users")
      .select("id,is_active").eq("id", claims.id).maybeSingle();
    if (userError) {
      console.error("Wallet user lookup failed:", userError.code ?? "unknown");
      return jsonResponse({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503);
    }
    if (!user || !user.is_active) return jsonResponse({ error: "USER_NOT_FOUND_OR_DISABLED" }, 401);

    const { data: roles, error: roleError } = await supabase.schema("platform").from("role_assignments")
      .select("role").eq("user_id", user.id).limit(2);
    if (roleError || !roles || roles.length !== 1) {
      console.error("Wallet role lookup failed:", roleError?.code ?? "invalid_role_assignment");
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
      console.error("Wallet query failed:", walletError.code ?? "unknown");
      return jsonResponse({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503);
    }
    const row = wallets?.[0];
    if (!row) return jsonResponse({ error: "WALLET_NOT_FOUND" }, 404);

    return jsonResponse({
      wallet: {
        id: row.id,
        userId: row.user_id,
        walletType: row.wallet_type,
        balance: String(row.balance ?? "0"),
        reservedBalance: String(row.reserved_balance ?? "0"),
        gameCode: row.game_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error("Wallet function failed:", error instanceof Error ? error.message : "unknown");
    return jsonResponse({ error: "WALLET_SERVICE_UNAVAILABLE" }, 503);
  }
});
