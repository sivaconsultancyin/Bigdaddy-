export function applyExplicitCorsOrigin(
  baseHeaders: Record<string, string>,
  origin: string | null | undefined,
  allowedOrigins: ReadonlySet<string>,
): Record<string, string> {
  const headers = { ...baseHeaders };
  // Never preserve a wildcard or a stale origin from a base header set.
  delete headers["Access-Control-Allow-Origin"];
  delete headers["Vary"];
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}
