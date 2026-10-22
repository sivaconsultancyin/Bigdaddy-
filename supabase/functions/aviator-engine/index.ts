import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function secretMatches(expected: string, supplied: string | null): boolean {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(expected) || !supplied) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(supplied);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const expected = Deno.env.get("AVIATOR_ENGINE_SECRET");
  const supplied = req.headers.get("x-aviator-engine-secret");
  if (!expected || !/^[A-Za-z0-9_-]{32,}$/.test(expected)) {
    return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  }
  if (!secretMatches(expected, supplied)) return json({ error: "UNAUTHORIZED" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);

  try {
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.schema("aviator").rpc("tick_crash_engine");
    if (error) {
      console.error("Aviator engine RPC failed:", error.code ?? "unknown");
      return json({ error: "ENGINE_TICK_FAILED" }, 503);
    }
    return json({ ok: true, engine: data ?? { action: "no_result" } });
  } catch (error) {
    console.error("Aviator engine invocation failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "ENGINE_TICK_FAILED" }, 503);
  }
});
