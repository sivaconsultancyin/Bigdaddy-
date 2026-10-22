#!/usr/bin/env node
/**
 * Read-only BigDaddy Supabase Edge API smoke checks.
 *
 * Required:
 *   SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)
 * Optional:
 *   BIGDADDY_API_BASE_URL (defaults to production API)
 *   BIGDADDY_SMOKE_USERNAME + BIGDADDY_SMOKE_PASSWORD for a real login test
 *   BIGDADDY_SMOKE_TOKEN for authenticated read-only checks without logging in
 *
 * This script deliberately does not create users/requests, transfer tokens, or place bets.
 * A successful login writes the application's normal USER_LOGIN audit entry.
 */
const API_BASE = (process.env.BIGDADDY_API_BASE_URL ??
  "https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api").replace(/\/$/, "");
const API_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const USERNAME = process.env.BIGDADDY_SMOKE_USERNAME;
const PASSWORD = process.env.BIGDADDY_SMOKE_PASSWORD;
const EXISTING_TOKEN = process.env.BIGDADDY_SMOKE_TOKEN;
const TIMEOUT_MS = Number(process.env.BIGDADDY_SMOKE_TIMEOUT_MS ?? 12000);

if (!API_KEY) {
  console.error("Set SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) before running smoke tests.");
  process.exit(2);
}
if ((USERNAME && !PASSWORD) || (!USERNAME && PASSWORD)) {
  console.error("Set both BIGDADDY_SMOKE_USERNAME and BIGDADDY_SMOKE_PASSWORD, or neither.");
  process.exit(2);
}

let failures = 0;
let passed = 0;
let skipped = 0;

async function request(method, path, { token, body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      apikey: API_KEY,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
    return { status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function check(name, method, path, expectedStatus, options, validate) {
  try {
    const result = await request(method, path, options);
    const valid = result.status === expectedStatus && (!validate || validate(result.data));
    if (valid) {
      passed++;
      console.log(`PASS ${name} (${result.status})`);
    } else {
      failures++;
      console.error(`FAIL ${name}: expected HTTP ${expectedStatus}, received ${result.status}; response=${JSON.stringify(result.data).slice(0, 300)}`);
    }
    return valid ? result : null;
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main() {
  await check("health/database", "GET", "/health", 200, {}, d =>
    d.status === "ok" && d.databaseConnected === true);
  await check("production config", "GET", "/config", 200, {}, d =>
    d.apiBackend === "supabase" && d.mode === "production");
  await check("login input validation", "POST", "/auth/login", 400, {
    body: { username: "x", password: "x" },
  }, d => d.error === "INVALID_USERNAME_OR_PASSWORD");

  await check("login rejects null JSON body safely", "POST", "/auth/login", 400, { body: null }, d =>
    d.error === "INVALID_JSON");
  await check("referral registration rejects null JSON body safely", "POST", "/auth/register-referral", 400, { body: null }, d =>
    d.error === "INVALID_JSON");
  await check("dice verification rejects null JSON body safely", "POST", "/games/dice/verify", 400, { body: null }, d =>
    d.error === "INVALID_JSON");

  for (const [name, method, path, body] of [
    ["auth/me rejects missing token", "GET", "/auth/me"],
    ["wallet rejects missing token", "GET", "/wallet/my-wallet"],
    ["wallet ledger rejects missing token", "GET", "/wallet/ledger"],
    ["token requests reject missing token", "GET", "/requests/list"],
    ["user creation rejects missing token", "POST", "/auth/create-user", {}],
  ]) {
    await check(name, method, path, 401, body === undefined ? {} : { body }, d =>
      d.error === "AUTH_REQUIRED");
  }

  let token = USERNAME && PASSWORD ? null : EXISTING_TOKEN;
  if (USERNAME && PASSWORD) {
    const login = await check("valid account login", "POST", "/auth/login", 200, {
      body: { username: USERNAME, password: PASSWORD },
    }, d => typeof d.token === "string" && d.token.length > 20 &&
      typeof d.user?.id === "string" && !!d.wallet);
    if (login) token = login.data.token;
  } else if (!token) {
    skipped++;
    console.log("SKIP valid account login (set BIGDADDY_SMOKE_USERNAME and BIGDADDY_SMOKE_PASSWORD to enable)");
  }

  if (token) {
    await check("authenticated user profile", "GET", "/auth/me", 200, { token }, d =>
      typeof d.user?.id === "string" && !!d.wallet);
    await check("authenticated personal wallet", "GET", "/wallet/my-wallet", 200, { token }, d =>
      typeof d.wallet?.id === "string" && d.wallet.balance !== undefined);
    await check("authenticated wallet ledger", "GET", "/wallet/ledger", 200, { token }, d =>
      Array.isArray(d.entries));
    await check("authenticated token request list", "GET", "/requests/list", 200, { token }, d =>
      Array.isArray(d.requests));
  } else {
    skipped += 4;
    console.log("SKIP authenticated profile/wallet/ledger/token-request reads (no token available)");
  }

  console.log(`\nSmoke-test summary: ${passed} passed, ${failures} failed, ${skipped} skipped.`);
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
