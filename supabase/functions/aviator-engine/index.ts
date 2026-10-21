import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const expected = Deno.env.get("AVIATOR_ENGINE_SECRET");
  const supplied = req.headers.get("x-aviator-engine-secret");
  if (!expected || expected.length < 32) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  if (!supplied || supplied.length !== expected.length || supplied !== expected) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.schema("aviator").rpc("tick_crash_engine");
  if (error) {
    console.error("Aviator engine RPC failed:", error.code ?? "unknown");
    return json({ error: "ENGINE_TICK_FAILED" }, 503);
  }
  return json({ ok: true, engine: data ?? { action: "no_result" } });
});
