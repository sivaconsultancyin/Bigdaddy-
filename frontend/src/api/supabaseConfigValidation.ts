export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
  hasRealtime: boolean;
}

function isLegacyAnonJwt(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const claims = JSON.parse(decoded) as { role?: unknown };
    return claims.role === "anon";
  } catch {
    return false;
  }
}

export function resolveSupabasePublicConfig(
  urlValue: string | undefined,
  keyValue: string | undefined,
  production: boolean,
): SupabasePublicConfig {
  const rawUrl = (urlValue ?? "").trim().replace(/\\/+$/, "");
  const publishableKey = (keyValue ?? "").trim();
  if (!rawUrl || !publishableKey) {
    if (production) throw new Error("SUPABASE_PUBLIC_CONFIG_MISSING");
    return { url: "", publishableKey: "", hasRealtime: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("SUPABASE_URL_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL_INVALID");
  }

  const isNewPublishableKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey);
  const isLegacyAnonKey = isLegacyAnonJwt(publishableKey);
  if (!isNewPublishableKey && !isLegacyAnonKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY_INVALID");
  }

  return {
    url: parsed.origin,
    publishableKey,
    hasRealtime: true,
  };
}
