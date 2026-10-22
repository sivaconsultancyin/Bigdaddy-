import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return respond({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Required Supabase server environment variables are missing.");
    return respond({ ok: false, error: "SERVER_CONFIGURATION_ERROR" }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify the Data API can reach the existing public.users table without
    // returning user data. This is a connectivity probe, not an auth endpoint.
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) {
      console.error("Supabase health database probe failed:", error.code ?? "unknown");
      return respond({
        ok: false,
        service: "bigdaddy-edge-functions",
        database: "unavailable_or_not_exposed",
        error: "DATABASE_PROBE_FAILED",
      }, 503);
    }

    return respond({
      ok: true,
      service: "bigdaddy-edge-functions",
      database: "reachable",
      timestamp: new Date().toISOString(),
    });
  } catch {
    console.error("Unexpected error during Supabase health probe.");
    return respond({ ok: false, error: "HEALTH_CHECK_FAILED" }, 503);
  }
});
