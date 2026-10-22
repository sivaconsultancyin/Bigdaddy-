import { jwtVerify, SignJWT } from "npm:jose@5.9.6";

export type BigDaddyClaims = {
  id: string;
  username: string;
  role: "OWNER" | "SUPER_ADMIN" | "ADMIN" | "PLAYER";
  parentId: string | null;
};

export function getJwtSecret(): Uint8Array {
  const secret = Deno.env.get("BIGDADDY_JWT_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("BIGDADDY_JWT_SECRET must match the existing backend JWT secret and be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signBigDaddyToken(claims: BigDaddyClaims): Promise<string> {
  return await new SignJWT({
    id: claims.id,
    username: claims.username,
    role: claims.role,
    parentId: claims.parentId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifyBigDaddyToken(token: string): Promise<BigDaddyClaims | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (protectedHeader.alg !== "HS256" || typeof payload.id !== "string" ||
        typeof payload.username !== "string" ||
        !["OWNER", "SUPER_ADMIN", "ADMIN", "PLAYER"].includes(String(payload.role))) {
      return null;
    }
    return {
      id: payload.id,
      username: payload.username,
      role: payload.role as BigDaddyClaims["role"],
      parentId: typeof payload.parentId === "string" ? payload.parentId : null,
    };
  } catch {
    return null;
  }
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
