# Aviator Supabase engine

The dedicated Edge Function is `supabase/functions/aviator-engine/index.ts`.
It is an authenticated trigger only; the authoritative round engine remains the
PostgreSQL function `aviator.tick_crash_engine()` defined by the existing
Aviator engine migration.

## Security and configuration

- The Edge Function accepts POST requests only.
- It checks `x-aviator-engine-secret` against the server-only
  `AVIATOR_ENGINE_SECRET` secret. Use a random value of at least 32 characters.
- The Supabase service-role key is read only from the Edge Function environment.
  Never add either secret to frontend code, the APK, or the Git repository.
- `supabase/config.toml` sets `verify_jwt = false` for this function because
  the handler authenticates the dedicated scheduler secret itself. Do not remove
  that handler-level authentication.

## Deploy

From the repository root, authenticate the Supabase CLI and link the intended
project first. Confirm the project ref is the one you intend to change.

```sh
supabase login
supabase link --project-ref nzvpuoeibqrpcltrszvr
supabase secrets set AVIATOR_ENGINE_SECRET='<generate-a-random-secret-of-32-or-more-characters>'
supabase functions deploy aviator-engine
```

Do not paste the real secret into GitHub, source files, logs, or a chat message.
Use your password manager or a secure random generator to create it.

## Scheduler requirement

A trusted server-side scheduler/worker must POST to
`https://<project-ref>.supabase.co/functions/v1/aviator-engine` about once per
second, sending `x-aviator-engine-secret: <the configured secret>`. Do not call
this endpoint from the browser or APK. Supabase Edge Functions are request
handlers and do not run as a permanent one-second loop by themselves.

Keep the existing `aviator-worker.ts` / production engine worker running until
the new scheduler is configured and verified. The database engine uses an
advisory transaction lock to serialize overlapping ticks, but running two
schedulers is wasteful and should be avoided after cutover.

## Verification checklist

1. An unauthenticated POST returns 401.
2. A GET request returns 405.
3. A POST with the configured scheduler secret invokes the database RPC.
4. Confirm successful ticks and round transitions in Supabase Edge Function and
   database logs before switching off the existing worker.
5. Test bet placement, cashout, crash settlement, retries and recovery in a
   non-production environment before enabling this path for real users.


## Worker reliability and single-owner telemetry

- The Cron watchdog runs every 15 seconds but calls the Edge Function only when
  the database lease is expired. A healthy owner or valid handoff therefore
  suppresses launcher HTTP requests.
- If an Edge continuation fails, it retries three times with bounded delays.
  After the retries, it releases the handoff lease only if that token still
  owns it; if the request was accepted but its response was lost, the release
  safely does nothing.
- If the Edge continuation facility is unavailable, the watchdog reclaims the
  lease after its 60-second handoff expiry.
- Structured logs include `workerId`, lease `generation`, acquisition,
  handoff, continuation retries/failure, and state transitions. Compare worker
  IDs and generations with `aviator.engine_worker_lease` to diagnose owner
  changes. PostgreSQL's existing advisory transaction lock remains the final
  serialization guard around each engine tick.
- The Node worker now supervises unexpected loop exits and retries lease
  acquisition after a short delay.
- Do not run the production migration until the Edge Function and Node worker
  build/tests pass and the deployment path is confirmed.
