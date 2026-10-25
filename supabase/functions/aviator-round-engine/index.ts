import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("ENGINE_NOT_CONFIGURED");
  return value;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let target: ReturnType<typeof createClient>;
  let secret: string;
  try {
    target = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    secret = requiredEnv("AVIATOR_ENGINE_SECRET");
  } catch {
    return json({ error: "ENGINE_NOT_CONFIGURED" }, 503);
  }

  const provided = req.headers.get("x-aviator-engine-secret") ?? "";
  if (!constantTimeEqual(provided, secret)) return json({ error: "AUTH_REQUIRED" }, 401);

  const { data, error } = await target.schema("aviator").rpc("tick_round_engine");
  if (error) {
    console.error("Aviator round engine tick failed:", error.code ?? "ENGINE_TICK_FAILED");
    return json({ error: "ROUND_ENGINE_UNAVAILABLE" }, 503);
  }
  return json({ result: data, serverTime: new Date().toISOString() });
});
