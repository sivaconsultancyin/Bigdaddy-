# BigDaddy Main Code Audit — 2026-11-10

- Repository: `sivaconsultancyin/Bigdaddy-`
- Branch reviewed: `main`
- Review type: static source review of the main application entry points, data access, authentication, wallet paths, Aviator engine/API, frontend realtime/animation, CI, deployment routing, and migration inventory.
- This is not a claim that every line of all 216 tracked files has been dynamically executed. No production writes, live DDL, financial mutations, or deployment changes were performed as part of this review.
- Severity: P0 = immediate release blocker; P1 = high risk; P2 = medium; P3 = low/maintenance.

## Executive summary

The repository has a substantial production-oriented Supabase/Edge implementation, including server-side JWT verification, atomic Aviator bet/cashout RPCs, distributed worker leases, and realtime multiplier broadcasts. However, there are critical architectural and financial-safety gaps between legacy Node/in-memory code and the deployed Render proxy → Supabase Edge API path. The most important risks are mixed data backends, an unsafe legacy wallet transfer path, demo credentials seeded in the in-memory store, migration ledger drift, and insufficient evidence of full PostgreSQL-backed financial and end-to-end tests.

## Findings

### P0 — Release blockers / immediate containment

#### BD-AUD-001 — Legacy wallet routes still perform financial operations against process-local in-memory storage
- File: `backend/src/routes/wallet.routes.ts`
- Evidence: wallet read, ledger, recipient lookup, transfer and `executeTransfer` all call `db.*` from `backend/src/db/storage`; transfer idempotency key is generated from `Date.now()`.
- Impact: if these routes are mounted/reachable in any deployed server mode, balances and ledger are not durable/shared across instances; restart or multiple instances can diverge. A timestamp-derived key is not a client-stable retry key, so retries can double-submit.
- Recommendation: remove or hard-disable legacy financial routes in production; route all wallet mutations through authenticated PostgreSQL RPCs with client-provided idempotency keys and transactionally enforced hierarchy/available-balance checks. Add an integration test proving this route cannot be reached in production.
- Validation needed: enumerate every mounted route in both server entry points and test deployed route map.

#### BD-AUD-002 — Development StorageEngine seeds known demo accounts and passwords
- File: `backend/src/db/storage.ts`
- Evidence: constructor seeds owner, super-admin, admin and player records with predictable usernames/emails and literal passwords before bcrypt hashing.
- Impact: dangerous if the in-memory engine is accidentally used in production, shared demo credentials are exposed, and test/demo identities can be mistaken for live accounts.
- Recommendation: remove seeded credentials from production code paths; seed only disposable test fixtures with random credentials. Fail startup if production can instantiate the in-memory storage engine. Rotate any credentials if these defaults were ever enabled on a reachable deployment.
- Validation needed: verify production build and route graph never import/use seeded storage for financial/auth paths.

### P1 — High risk

#### BD-AUD-003 — Multiple backend execution paths make route/data-source consistency difficult to guarantee
- Files: `render-proxy.ts`, `server.ts`, `backend/src/db/storage.ts`, `backend/src/db/postgres.ts`, `supabase/functions/api/index.ts`, `supabase/functions/aviator-api/index.ts`.
- Evidence: package start script runs `tsx render-proxy.ts`; Render proxy forwards application requests to Supabase Edge `/functions/v1/api`. A separate Express `server.ts` contains legacy routers and PostgreSQL startup/worker orchestration. The repository also has a separate `aviator-api` Edge Function with its own auth and state/bet implementation.
- Impact: security fixes or API behavior may be applied to one path but not the deployed path; two Aviator APIs may drift in authorization, validation, response shape, and financial semantics.
- Recommendation: publish a single canonical production route map; mark legacy server/routes as development-only or remove them after migration. Decide whether `aviator-api` is active; if not, decommission it, otherwise share common contract tests and versioned RPCs.
- Validation needed: inspect Render service start command and Supabase function deployment/configuration; run route-level tests against the actual deployed entry point.

#### BD-AUD-004 — Legacy direct wallet transfer does not use a stable caller idempotency key
- File: `backend/src/routes/wallet.routes.ts`
- Evidence: `idempotencyKey: TRANSFER_<sender>_<recipient>_<Date.now()>`.
- Impact: network retries produce new keys; duplicate transfers are possible if this route is live and the client retries after a timeout.
- Recommendation: require and validate `Idempotency-Key`; persist request fingerprint and result atomically; reject same key with a different sender/recipient/amount; test concurrent duplicate submissions.
- Note: this is a distinct concrete defect within the legacy in-memory path and is covered by BD-AUD-001's containment recommendation.

#### BD-AUD-005 — Shared Supabase migration ledger and repository migration files are materially out of sync
- File: `docs/shared-supabase-migration-ledger-reconciliation.md`
- Evidence from the documented read-only snapshot (2026-11-09): 65 applied ledger entries vs 55 SQL files; 21 exact version+name matches; 44 applied entries without an exact filename match; 34 repository files not represented by an exact applied version+name; two duplicate version prefixes.
- Impact: a normal migration push may attempt already-applied effects or apply migrations in an unsafe order; financial schema/function behavior may diverge.
- Recommendation: do not run `supabase db push`, migration repair, or manual production DDL until a row-by-row source/effect reconciliation and restore-tested rollback plan are approved. Resolve duplicate timestamps and test clean bootstrap plus upgrade-from-live-ledger in disposable PostgreSQL.
- Status: already documented in merged PR #124; remains an operational blocker until reconciled.

#### BD-AUD-006 — Test coverage does not yet prove production financial behavior end-to-end
- Files: `test/run_tests.ts`, `.github/workflows/ci.yml`, `scripts/production_financial_reconciliation.sql`.
- Evidence: package test command runs `test/run_tests.ts`; the documented earlier audit states this suite exercises the in-memory store. CI includes targeted disposable PostgreSQL tests for selected lease/realtime/security migrations, but that is not equivalent to complete wallet/bet/cashout/refund concurrency and rollback coverage.
- Impact: unit tests can pass while PostgreSQL locking, RPC authorization, idempotency, constraints, RLS, and settlement transactions fail in production.
- Recommendation: add disposable PostgreSQL integration tests for wallet transfer, bet funding/outbox, cashout, settlement, refunds, token-supply invariant, duplicate/concurrent requests, worker lease handoff, and rollback. Add deployed Edge API smoke tests using synthetic accounts in staging.
- Validation needed: run CI and capture the exact workflow results; no successful full test run is asserted by this audit.

#### BD-AUD-007 — Two Aviator API implementations create potential contract and authorization drift
- Files: `supabase/functions/api/aviator.routes.ts`, `supabase/functions/aviator-api/index.ts`.
- Evidence: both implement Aviator bet/state paths; the dedicated function independently verifies JWT and queries the shared auth project, while the general API uses a separate actor resolver and authenticated atomic RPC path.
- Impact: clients may hit different implementations depending on URL/configuration, with different idempotency constraints and response behavior.
- Recommendation: choose one canonical API and route all clients through it; if both are required, extract shared contract fixtures and run identical auth, validation, idempotency and response tests against both.

#### BD-AUD-008 — Aviator worker failure paths need explicit lease-release/expiry observability tests
- File: `supabase/functions/aviator-engine/index.ts`
- Evidence: when heartbeat reports lease lost, function returns 409; lease release is explicit on tick RPC failure, while other early failure/exception paths rely on lease TTL expiry. Handoff and continuation scheduling are separate asynchronous steps.
- Impact: temporary orphaned lease delays recovery; handoff/continuation failures may leave a round stalled until TTL expiry.
- Recommendation: wrap lease ownership in a single try/finally lifecycle, release only with matching owner token, record handoff failures and recovery lag, and test timeout/exception/continuation rejection/lease-loss cases. Do not weaken fencing/owner-token checks.
- Validation needed: fault-injection tests for every exit branch.

### P2 — Medium risk / performance and maintainability

#### BD-AUD-009 — Supabase Realtime and state polling need operational freshness SLOs
- Files: `frontend/src/context/WebSocketContext.tsx`, `shared/src/aviatorRealtime.ts`, `supabase/functions/aviator-api/index.ts`.
- Evidence: frontend has authoritative realtime multiplier handling plus polling/state fetch logic; the separate state API derives live multiplier from server timestamps and crash multiplier.
- Impact: missed or delayed events, stale state responses, duplicate events, or round transitions can cause UI lag or confusing animation even when the database engine is correct.
- Recommendation: instrument per-round event sequence/version, server event timestamp, client receive lag, polling fallback count, and round-ID transitions. Test reconnect, out-of-order/duplicate events, missing final crash event, and round rollover. Keep displayed multiplier subordinate to authoritative server state.
- Positive observation: frontend currently reads the Realtime multiplier payload and resets animation tracking on round ID changes; this is a useful existing safeguard, not a finding of absence.

#### BD-AUD-010 — Realtime client configuration is hard-coded to a specific Supabase project
- File: `frontend/src/context/WebSocketContext.tsx`
- Evidence: Realtime URL and fallback publishable key are literal constants.
- Impact: staging/fork/local environments can silently subscribe to the production project; project migration requires code changes.
- Recommendation: use validated Vite environment variables for URL and publishable key, fail clearly when absent, and ensure only publishable keys are shipped to browsers.

#### BD-AUD-011 — Proxy health/readiness endpoints report process health, not upstream readiness
- File: `render-proxy.ts`
- Evidence: `/health` always returns status ok and `/ready` returns ready with configured upstream string without checking upstream connectivity.
- Impact: Render may mark the proxy healthy while Supabase Edge API is unavailable; monitoring can miss user-facing outages.
- Recommendation: keep liveness separate; make readiness perform a bounded, non-mutating upstream health check and return 503 on dependency failure. Avoid exposing sensitive upstream configuration in public responses.

#### BD-AUD-012 — API proxy buffers complete upstream responses and permits 40-second requests
- File: `render-proxy.ts`
- Evidence: upstream response is fully buffered with `arrayBuffer()`; timeout is 40 seconds.
- Impact: large responses consume memory per request and long waits can tie up proxy resources during incidents.
- Recommendation: stream response bodies where supported, cap request/response sizes, set endpoint-specific timeouts and add concurrency/rate limits on sensitive endpoints.

#### BD-AUD-013 — CORS defaults to wildcard when explicit allowed origins are absent
- File: `supabase/functions/api/index.ts`
- Evidence: if `BIGDADDY_ALLOWED_ORIGINS` is empty, Access-Control-Allow-Origin is `*`.
- Impact: any browser origin can make cross-origin requests; CORS is not authorization, but a strict production origin allowlist reduces exposure and accidental embedding.
- Recommendation: require a non-empty production origin allowlist and fail production configuration validation if absent. Keep native app origins explicitly documented.

## Positive controls observed

- Supabase service-role credentials are read server-side in Edge Functions; browser uses a publishable key for Realtime.
- General API actor resolution checks current active user and exactly one current role assignment, and compares role to JWT claims.
- Aviator bet and cashout routes call authenticated atomic database RPCs.
- Dedicated engine code uses owner tokens, lease claim/heartbeat/handoff RPCs and bounded execution windows.
- `supabase/functions/aviator-engine` validates a long secret using constant-time byte comparison.
- Database clients use bounded connection pools, statement/lock timeouts and separate auth/wallet/engine pools in the legacy server.
- Frontend realtime multiplier parsing and round-ID animation reset are present.

## Remediation status (rechecked 2026-11-10)

### Merged and CI-verified
- **BD-AUD-001 / BD-AUD-002 / BD-AUD-004:** PR #131 blocks the in-memory StorageEngine in production and removes eager production imports of seeded storage. Issue #125 closed.
- **BD-AUD-010 / BD-AUD-011 / BD-AUD-012 / BD-AUD-013:** PRs #133, #136, #137 and #138 add upstream readiness, streaming/response caps, bounded proxy concurrency, explicit Edge CORS origins, and trusted/untrusted-origin tests. Issue #128 closed.
- **BD-AUD-003 / BD-AUD-007:** PR #148 consolidates Aviator HTTP routing on the single active Supabase project, archives the inactive API/workers/migrations, and adds single-project regression tests. All six CI jobs passed; Issue #126 closed.
- **BD-AUD-006 (partial):** PR #135 adds disposable PostgreSQL concurrent wallet-transfer/idempotency tests. PR #139 adds worker lease fault/expiry tests. Issue #127 remains open for concurrent Aviator cashout/settlement/refund and rollback-injection coverage.
- **BD-AUD-008 / BD-AUD-009 (partial):** PR #139 tests lease ownership and expiry. PR #146 adds per-round tick sequence, server timestamps, stale-event rejection, and Realtime lag/reconnect/polling-fallback diagnostics. Sequence-gap counters, missing-terminal-event cases, and mobile/staging E2E remain open.

### In progress / not applied to production
- **Legacy isolated Aviator implementation:** the eleven old migrations, four old Edge Functions, and redundant separate security/index candidate are archived under `supabase/archive/legacy-isolated-aviator/`; they are not part of the active CLI or deployment paths.
- **Migration ledger drift:** Issue #120 remains open. Single-project ledger: 65 applied versions vs 57 active root migration files (21 exact matches, 44 applied-only, 36 file-only, 2 duplicate prefixes). The eleven former isolated-project migrations, one separate security/index candidate, and four inactive Edge Functions are archived outside active Supabase CLI paths. PR #143/#146/#148 maintain the inventory manifest and CI guard. The remaining 65/58 drift is not yet reconciled.
- **Production Phase 1:** Issue #123 remains open for clean bootstrap/upgrade tests, financial reconciliation queries, and additional transaction rollback coverage.
- **Frontend Vite environment migration:** Issue #144 remains open. Project URLs and publishable-key fallbacks must move to validated build-time environment variables after the Render workspace is confirmed.

## Recommended remediation order

1. Complete single-project consolidation: route all Aviator HTTP calls through the canonical API and keep abandoned migration/function sources outside active Supabase CLI paths.
2. Complete API auth, validation, idempotency, and response contract tests on the canonical Aviator routes (BD-AUD-003/007).
3. Reconcile the single project's 65 applied migration effects against its 58 active source files and run clean-bootstrap/upgrade tests before any production migration push (BD-AUD-005).
4. Add concurrent Aviator cashout/settlement/refund tests and rollback injection, then run staging end-to-end financial flows (BD-AUD-006).
5. Complete Realtime sequence-gap/terminal-event coverage and mobile end-to-end validation (BD-AUD-008/009).
6. Move frontend Supabase URLs and publishable keys to validated Vite environment variables after Render workspace confirmation (BD-AUD-010–013).

## Audit limitations / evidence still required

- Static code review only; the complete 216-file tree was inventoried, and key production/runtime files were inspected, but not every line of every file was exhaustively reviewed.
- No production login, bet, cashout, settlement, wallet transfer, or refund was executed.
- No live database DDL, migration repair, schema mutation, or financial data change was performed.
- No Render deployment logs, Supabase live function logs, full database catalog, backup restore, or mobile end-to-end session was verified in this audit.
- Findings about route reachability must be confirmed against the deployed Render start command and deployed Supabase function configuration before declaring a specific legacy endpoint externally exploitable.

## Related repository work

- PRs #131, #133–#141, #143, #146, #147, and #148 have merged with all six CI jobs passing on their final commits.
- PR #124 and PR #143/#146/#148 document and lock the single-project migration inventory; they do not repair the remaining live migration history drift.
- PR #140's separate-project grant/index migration is archived; live inspection confirmed its proposed indexes already exist and browser-role EXECUTE is already revoked on `public.rls_auto_enable()`. PR #148 adds an idempotent source-controlled privilege migration for this state.


## Operational follow-up — single Supabase project confirmation (2026-11-10)

- The user explicitly approved pausing the former isolated project `yrleubhpiqejfvingqfj` (`Bigdaddy aviator`).
- Supabase accepted the pause request. A subsequent `list_projects` response returned only the canonical `nzvpuoeibqrpcltrszvr` (`Bigdaddy`) project, still `ACTIVE_HEALTHY`; the former project no longer appeared in the active project list.
- No project deletion, restore, production DDL, migration repair, wallet/bet/round mutation, or deployment was performed.
- Treat the canonical project as the sole active target. Do not deploy or restore the former project without a new explicit approval.
- Migration reconciliation remains blocked pending provenance/effect review and disposable PostgreSQL bootstrap/upgrade evidence. The project pause does not resolve the 65-version migration-ledger drift.


## Production recheck addendum — 2026-11-10 (read-only)

### Verified current state
- Active Supabase project: `nzvpuoeibqrpcltrszvr`, PostgreSQL 17.11, status `ACTIVE_HEALTHY`.
- Live migration ledger: 65 applied versions. Active root migration files in GitHub main: 57. Exact version+name matches: 21; applied-only: 44; source-only: 36; duplicate version prefixes: `20261021120000` and `20261023160000`.
- Production catalog: Aviator and Roulette are ACTIVE. Dice, Dragon Tiger and Andar Bahar remain COMING_SOON; their dedicated pool balances are zero. Do not activate or fund them as part of this audit.
- Read-only database checks found four users, ten wallets, 238 wallet transactions, and 89 Aviator bets at the time of inspection. No row contents or financial mutations were accessed/performed.
- Supabase security advisor reports one INFO finding: `aviator.engine_worker_lease` has RLS enabled with no policies. Direct SELECT privileges are false for anon, authenticated and service_role, consistent with access through server-side privileged RPCs; do not add a browser policy merely to silence the advisor.
- Performance advisor reports 46 unused-index INFO notices. These are not grounds for dropping indexes without workload and query-plan evidence.
- The deployed `aviator-engine` Edge Function entrypoint exactly matches GitHub main at the time of comparison.

### New P1 finding — deployed API Edge Function source drift
- The deployed Supabase `api` Edge Function is version 36, last updated 2026-10-24.
- Its deployed `index.ts` is 67,363 characters / 956 lines; current GitHub main `supabase/functions/api/index.ts` is 58,130 characters / 810 lines and imports the separate `aviator.routes.ts` module, which is absent from the deployed function bundle.
- The deployed Dice verifier still uses the `clientSeed:nonce` HMAC input and first-eight-hex-digit calculation. Current main (fixed by PR #162) uses the authoritative `dice` label and first 13 HMAC hex digits.
- The deployed CORS code has a wildcard fallback when `BIGDADDY_ALLOWED_ORIGINS` is empty; current main uses an explicit origin allowlist without wildcard fallback.
- The deployed API retains older inline Aviator bet/cashout/state handlers and older actor lookup logic. These differences may leave security, fairness and performance fixes merged to main inactive in production.
- Tracked in GitHub issue #163. Production Edge Function deployment is intentionally not performed: it requires a separate reviewed rollout plan and explicit deployment confirmation.

### CI and PR recheck
- Main commit `c6e383ef8d136b686aefedcedf21377d3e649f34` passed all 7 GitHub Actions jobs, including build/typecheck/tests, Edge Function type checks and targeted PostgreSQL migration/lease/Realtime fixtures.
- PR #155 (single-project cutover status documentation) was reviewed and merged.
- PR #152 remains blocked and unmerged. Its reconstructed migration sources have unresolved provenance/effect mismatches; it must not be merged or applied to production until its review gates pass.
- The Render frontend is a static site and the latest observed deployment was live on commit `7821b852dfeaae2e2f2da0a9d0b8c38148b6abf5`. The frontend now targets the canonical Supabase Edge API directly. The separate Render backend proxy's latest observed live deploy is from 2026-10-24 and is not in the current frontend API request path.

### Audit limitations
- This recheck used read-only GitHub, Supabase metadata/SQL, Edge Function source, and Render service/deploy metadata.
- No production Edge Function deployment, Render environment-variable change, migration repair, production DDL, wallet/bet/round mutation, game activation, or financial transaction was performed.
- The deployed API environment secrets and actual origin allowlist values were not exposed or inspected. The wildcard CORS branch is therefore a code-path risk; whether it is active in the current environment remains unverified.
