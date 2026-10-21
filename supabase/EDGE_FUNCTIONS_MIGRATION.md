# BigDaddy Supabase Edge Functions migration

## First deployed function: `health`

Project: `nzvpuoeibqrpcltrszvr` (Bigdaddy, ap-southeast-2)

Endpoint:

`https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/health`

The endpoint is a public, read-only health probe. It checks that the Supabase Data API can query `public.users` and returns only status metadata, never user rows. A `503 DATABASE_PROBE_FAILED` means to inspect Data API exposure/permissions and function logs; it does not mean user data was returned.

Test manually:

```sh
curl -i https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/health
```

Expected success shape:

```json
{
  "ok": true,
  "service": "bigdaddy-edge-functions",
  "database": "reachable",
  "timestamp": "..."
}
```

The deployed function is currently active with JWT verification disabled because this endpoint only reports service health and does not expose business data. Keep this exception limited to health checks. All business endpoints must authenticate the existing BigDaddy JWT or deliberately migrate to Supabase Auth, validate user identity/permissions, validate input, and apply rate limits.

## Important architecture boundary

The existing application issues its own JWTs from `backend/src/services/auth.service.ts`; these are not Supabase Auth access tokens. Do not assume Supabase's default JWT verification validates those tokens. Before moving login or financial endpoints, implement and test explicit verification of the current BigDaddy JWT using a server-only secret, or plan a controlled Supabase Auth migration.

## Migration order

1. Deploy and test the health probe.
2. Implement a shared authentication/authorization helper for the existing BigDaddy JWT; never trust a client-supplied user ID.
3. Migrate read-only profile/config endpoints first.
4. Migrate bet placement, cashout, wallet transfer, and settlement only through atomic PostgreSQL RPCs with idempotency keys and server-side validation.
5. Keep the persistent Aviator round engine/WebSocket on a long-running service until its lifecycle and timing requirements have been redesigned and tested.
6. Run regression tests and compare old/new API responses before switching production traffic.

## Secrets

Never commit `SUPABASE_SERVICE_ROLE_KEY`, JWT signing secrets, or database passwords. Edge Function secrets must remain server-side and must never be bundled into the frontend or APK.

## Status

- [x] Initial Edge Function scaffold committed to the migration branch.
- [x] `health` function deployed to the Bigdaddy Supabase project.
- [ ] Live HTTP response verification.
- [ ] BigDaddy JWT auth helper.
- [ ] Business endpoint migrations and regression tests.
- [ ] Production traffic cutover.

No existing Render API or game worker has been removed or switched by this change.


## Authentication migration: login + current-user profile

The `auth-login` and `auth-me` functions are deployed as a first implementation, but are **not ready for production traffic until the setup and verification below are completed**.

### Required secret

In Supabase Dashboard → Edge Functions → Secrets, set:

- `BIGDADDY_JWT_SECRET`: the exact same secret currently used by the Render backend's `config.jwtSecret`.

Do not paste the secret into GitHub, this chat, frontend build variables, or the APK. Do not rotate the existing Render secret during this migration. If the existing secret is shorter than 32 characters, review and coordinate a safe rotation rather than silently changing it.

The Edge Functions sign the same HS256 token shape as BigDaddy's existing `AuthService.generateToken`, including the `id`, `username`, `role`, and `parentId` claims and a 7-day expiry. `auth-me` verifies the signature and expiry, then re-reads the active user and role from the database. It does not trust the role in the request body.

### Data API schema access

The functions query `platform` and `wallet` schemas using the server-only service-role key. Check Supabase Dashboard → Settings → API → Exposed schemas. If either schema is not exposed, these queries will fail with a PostgREST schema error. Expose only the required schemas and verify grants/RLS before doing so; do not grant `anon` or `authenticated` broad access. The service-role key must never be placed in the client.

### Endpoints

- `POST /functions/v1/auth-login` with JSON `{"username":"...","password":"..."}`
- `GET /functions/v1/auth-me` with `Authorization: Bearer <BigDaddy JWT>`

The functions are deployed with gateway JWT verification disabled because the existing BigDaddy token is not a Supabase Auth JWT. `auth-me` performs explicit HS256 verification in the function. Keep that manual verification in place.

### Important compatibility notes

- The existing Render login route remains unchanged and is still the production route until the frontend/API base URL is deliberately switched after regression tests.
- The Edge Function uses `bcryptjs` to verify the existing password hash.
- Login attempts are audited; if the audit insert fails, login fails closed.
- Test successful login, invalid password, inactive user, expired/tampered token, disabled user, role mismatch, OWNER treasury wallet, and ordinary user wallet before cutover.
- Do not migrate registration, bootstrap-owner, wallet transfers, bets, or settlements as part of this first auth slice.
