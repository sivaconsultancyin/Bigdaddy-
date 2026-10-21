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
