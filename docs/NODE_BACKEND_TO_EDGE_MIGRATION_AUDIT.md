# Node.js Backend → Supabase Edge Functions Migration Audit

**Audit date:** 2026-10-22  
**Repository:** `sivaconsultancyin/Bigdaddy-`  
**Supabase project:** `nzvpuoeibqrpcltrszvr`  
**Scope:** production Node.js/Express runtime, route parity, dependencies, game worker, and release gates.

## Executive result

**Migration is not certified complete. Keep the Render Node service running.** The existing Supabase Edge Function `api` is active at version 15 and already implements many production API routes. However, the Node service also owns startup/recovery logic and launches a persistent Aviator worker. The previous live smoke audit also recorded a 15-second timeout from the Render backend health URL, while valid-account end-to-end flows and browser asset/API verification remain incomplete.

The correct rollout is incremental: audit route parity, implement/test any gaps in a non-production branch, verify the deployed Edge Function with read-only and approved test-account flows, then cut over. Do not delete or suspend Render before all gates below pass.

## Runtime and dependency inventory

| Node component | Current responsibility | Edge migration assessment |
|---|---|---|
| `server.ts` | Express server, HTTP/CORS/security headers, health/readiness/config, error handling, route mounting, static frontend serving, DB reconnect timer, child-worker supervision | HTTP route logic can be moved to Edge handlers. Static assets already have a separate Render Static Site. Process lifecycle and child process supervision cannot be copied as-is. |
| `express` | Router/middleware composition | Replace with Fetch `Request`/`Response` handlers or a Deno-compatible router. Preserve status codes, body validation, CORS and error contracts. |
| `postgres` | Persistent PostgreSQL pools; separate API/auth/wallet/engine pools; transaction scopes, advisory locks, lock and statement timeouts | Existing Edge code uses `@supabase/supabase-js` over HTTPS. Rewrite SQL/transactions with reviewed Postgres RPCs or supported database calls; do not emulate atomic wallet/settlement transactions with separate REST requests. |
| `node:crypto` | HMAC/SHA-256, UUIDs, secure random seeds | Use Web Crypto APIs and verify output compatibility with test vectors before replacing any fairness/token logic. |
| `node:child_process` | Launch and restart `aviator-worker.ts` | Not available as a persistent child process in an Edge Function. Remove only after the replacement scheduler/engine is verified and duplicate execution is ruled out. |
| `node:http` + `ws` | Worker health listener and legacy WebSocket broadcasts | Edge Functions are request-oriented and do not provide this Node HTTP/WebSocket server lifecycle. Confirm whether any production frontend still uses `/ws`; if required, move realtime delivery to Supabase Realtime/Broadcast or a separately hosted service. |
| `vite`, `react`, `react-dom`, Tailwind | Frontend build/dev middleware | Build-time/frontend dependencies, not backend runtime requirements. The existing Render Static Site already serves the built frontend. |
| `bcryptjs`, `jsonwebtoken`, `zod` | Password hashes, legacy token contracts, request validation | Edge API already uses pinned `bcryptjs` and `jose` imports. Preserve the exact token claims/secret and hash compatibility; use validation tests for every route. |
| `tsx`, TypeScript | Run and type-check the Node service | Node-only startup scripts should not be deployed to Edge; use Supabase/Deno type-check and function tests for Edge code. |

## Production route status

The Express production server mounts `productionRouter`, `productionRequestsRouter`, and `authoritativeGamesRouter`. It deliberately does **not** mount the legacy in-memory wallet/game routers in production. It returns 503 for unsupported legacy game routes and the legacy audit route.

The current API migration inventory documents Edge handlers for health/readiness/config, auth, wallet, token requests, game list/activation, Aviator state/history/bet/cashout, monitoring failures, audit logs, and authoritative-game state/bet endpoints. Those mappings must be verified against the actual handler code and live behavior; a route listed in documentation is not proof of parity.

Known explicit gaps/guards from the current inventory:
- Dice slider/target bet payloads fail closed with `503 DICE_SLIDER_MODE_NOT_MIGRATED`.
- Teen Patti routes fail closed with `503 TEEN_PATTI_MIGRATION_NOT_READY`.
- Non-Aviator games are currently marked `COMING_SOON` and have no authoritative rounds in production; they must not be exposed as active until persistent atomic settlement is ready.
- `POST /auth/bootstrap-owner` is intentionally not a public route; keep owner bootstrap restricted to a controlled administrative operation.
- Legacy in-memory WebSocket game engines are not equivalent to authoritative persistent rounds. Do not re-enable them as a shortcut.

Reference inventory: [SUPABASE_EDGE_ROUTE_MIGRATION.md](../SUPABASE_EDGE_ROUTE_MIGRATION.md)

## Critical correctness and security checks

1. **Financial atomicity:** wallet reservation, bet placement, cashout, transfer, and settlement must run inside database transactions or single reviewed RPCs. Preserve idempotency keys and reject conflicting replays.
2. **Authorization:** verify current user is active and database role still matches token claims. Enforce role hierarchy/ownership on every read and write; never trust frontend role or user metadata.
3. **JWT/password compatibility:** compare Node and Edge token claims, expiration, HS256 signature, password hash verification, and disabled-user behavior.
4. **Fairness compatibility:** test deterministic test vectors for HMAC/SHA-256, crash multiplier boundaries, seed commitments, and seed reveal timing. Never reveal a live round's server seed.
5. **Timeouts/retries:** design idempotent retries for Edge/HTTP and database calls. A failed network response must not duplicate a bet, payout, transfer, or round.
6. **CORS/headers:** verify configured origins, preflight requests, request-size limits, security headers, and consistent JSON error envelopes.
7. **Worker exclusivity:** confirm the cron Edge engine and Node worker cannot advance/settle the same logical round concurrently. Use a database advisory lock/unique constraints as a second line of defense.
8. **Secrets:** service-role key, database URLs, and JWT signing secret must remain server-side. Never put them in Vite variables or APK assets.
9. **Realtime:** identify active frontend subscriptions to `/ws` before changing the Node service. HTTP route parity alone does not prove WebSocket parity.
10. **Observability:** preserve request IDs and safe failure logging without recording passwords, bearer tokens, or request bodies.

## Required test gates before production cutover

### A. Repository CI (must pass on the migration branch)
- `bun install --frozen-lockfile` (or the repository's lockfile-compatible install command).
- `bun run lint`.
- `bun run test` (financial invariants, role hierarchy, idempotency, settlement helpers).
- `bun run build`.
- Existing schema-isolation and wallet idempotency migration tests in `.github/workflows/ci.yml`.
- New Edge route tests must run against the Deno-compatible function code, not only string-match a route name.

### B. Edge function tests (must pass before deploying a candidate)
- Valid and invalid login; inactive user; stale role token; malformed/null/non-object bodies.
- Missing/invalid token on every protected route.
- Owner/Super Admin/Admin/Player hierarchy boundary cases.
- Wallet read/ledger and transfer exact replay/conflicting idempotency key.
- Token request create/list/approve/reject, including wrong approver and already-resolved request.
- Aviator state/history/bet/cashout, including insufficient funds, duplicate request, crash/cashout race, and settlement retry.
- Every route in the route inventory: correct method, expected status, and stable response shape.
- Unsupported games remain closed; no game is listed as active unless its persistent engine/settlement is ready.
- Health and readiness reflect actual dependencies; readiness must not return success unconditionally if required configuration/database checks fail.

### C. Live staging/production smoke tests (read-only first)
- Frontend homepage and every JS/CSS asset return 200.
- Browser network calls use `https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api`, not the Render API.
- Health/config and unauthenticated rejection tests pass.
- With an approved test account: login, profile, wallet, ledger, request list, role checks, and logout/session expiry.
- Controlled test-account write tests in staging: request lifecycle and a reversible/sandboxed bet/cashout/settlement.
- Confirm recent cron executions, one authoritative active round, and no duplicate worker ownership.
- Monitor errors/latency and keep rollback to the Render API possible during the cutover window.

### D. Render retirement gate

Do **not** stop, suspend, or delete `bigdaddy-backend` until all of the following are true:
- CI and Edge-specific tests pass.
- All production routes have verified Edge equivalents or an explicitly approved, documented disabled status.
- Frontend static assets and browser-to-Edge API calls pass.
- Approved authenticated flows and financial idempotency/settlement tests pass.
- Aviator engine and any required realtime path have a verified replacement.
- Rollback plan is exercised and the user-visible production service is stable through an observation window.

## Immediate next steps

1. Keep this audit branch isolated from `main`; do not deploy or change Render service state during audit.
2. Add/execute Edge-specific route and financial behavior tests against the current `api` function.
3. Fix gaps one route group at a time, using database RPCs where atomicity is required.
4. Deploy only a tested candidate; rerun live smoke checks and update this report with evidence.
5. Retire the Node service only after the retirement gate is satisfied.
