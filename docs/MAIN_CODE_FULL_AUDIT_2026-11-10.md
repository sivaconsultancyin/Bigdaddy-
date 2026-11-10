# BigDaddy Main Code Audit — 2026-11-10

- Repository: `sivaconsultancyin/Bigdaddy-`
- Branch reviewed: `main`
- Review type: static source review of the main application entry points, data access, authentication, wallet paths, Aviator engine/API, frontend realtime/animation, CI, deployment routing, and migration inventory.
- This is not a claim that every line of all 216 tracked files has been dynamically executed. No production writes, live DDL, financial mutations, or deployment changes were performed as part of this review.
- Severity: P0 = immediate release blocker; P1 = high risk; P2 = medium; P3 = low/maintenance.

## Executive summary

The repository has a substantial production-oriented Supabase/Edge implementation, including server-side JWT verification, atomic Aviator bet/cashout RPCs, distributed worker leases, and realtime multiplier broadcasts. However, there are critical architectural and financial-safety gaps between legacy Node/in-memory code and the deployed Render proxy → Supabase Edge API path. The most important risks are mixed data backends, an unsafe legacy wallet transfer path, demo credentials seeded in the in-memory store, migration ledger drift, and insufficient evidence of full PostgreSQL-backed financial and end-to-end tests.

## Findings

### Historical P0 findings — resolved for the current deployment path (PR #131)

#### BD-AUD-001 — Legacy wallet routes still perform financial operations against process-local in-memory storage
- File: `backend/src/routes/wallet.routes.ts`
- Evidence: wallet read, ledger, recipient lookup, transfer and `executeTransfer` all call `db.*` from `backend/src/db/storage`; transfer idempotency key is generated from `Date.now()`.
- Impact: if these routes are mounted/reachable in any deployed server mode, balances and ledger are not durable/shared across instances; restart or multiple instances can diverge. A timestamp-derived key is not a client-stable retry key, so retries can double-submit.
- Recommendation: keep this legacy router unmounted or remove it; all production wallet mutations must remain on authenticated PostgreSQL RPCs.
- Status: PR #131 blocks the in-memory StorageEngine in production and removes eager production imports. The active Render service runs `render-proxy.ts` (Supabase Edge API proxy); `server.ts` mounts only the production routers and does not mount this legacy wallet router. This is not currently reachable through the verified production route map.

#### BD-AUD-002 — Development StorageEngine seeds known demo accounts and passwords
- File: `backend/src/db/storage.ts`
- Evidence: constructor seeds owner, super-admin, admin and player records with predictable usernames/emails and literal passwords before bcrypt hashing.
- Impact: dangerous if the in-memory engine is accidentally used in production, shared demo credentials are exposed, and test/demo identities can be mistaken for live accounts.
- Recommendation: keep demo seed credentials isolated to disposable development/test fixtures and never import the in-memory store in production.
- Status: PR #131 blocks production use of the StorageEngine and removes eager production imports. The active Render proxy does not mount the Express in-memory routes; no evidence of these demo credentials being reachable in the current production path was found. Keep the source cleanup as a maintenance task, not a current P0.

### P1 — High risk

#### BD-AUD-003 — Multiple backend execution paths make route/data-source consistency difficult to guarantee
- Files: `render-proxy.ts`, `server.ts`, `supabase/functions/api/index.ts`, `supabase/functions/api/aviator.routes.ts`, `supabase/functions/aviator-engine/index.ts`.
- Evidence: package start script runs `tsx render-proxy.ts`; the active Render backend service is the Supabase Edge proxy, while the frontend now calls the canonical Supabase API directly. `server.ts` is not the Render start entrypoint and mounts only the production routers. The historical standalone `aviator-api` function was archived by PR #148 and had no requests in the last 24-hour Edge logs. The remaining live divergence is concrete: deployed Supabase `api` version 36 (last updated 2026-10-24) differs materially from current main and lacks the `aviator.routes.ts` bundle.
- Impact: security, fairness-verification, authentication, idempotency, and response-contract changes merged into main may not yet be active in the deployed API.
- Recommendation: maintain one canonical production API, reconcile/deploy the current main source only after a reviewed rollout/rollback plan, and add a release parity check that records deployed function version/source commit.
- Status: the historical multiple-API concern was addressed by PR #148; current deployed-source drift is tracked in P1 issue #163. The old Render proxy deployment is not in the current frontend request path.

#### BD-AUD-004 — Legacy direct wallet transfer does not use a stable caller idempotency key
- File: `backend/src/routes/wallet.routes.ts`
- Evidence: `idempotencyKey: TRANSFER_<sender>_<recipient>_<Date.now()>`.
- Impact: network retries would produce new keys if this legacy route were mounted.
- Status: the route is not mounted by the verified production entry points; PR #131 contains the production StorageEngine guard. The production wallet path uses the Supabase/PostgreSQL idempotent RPCs. Retain a source-level cleanup/test task, but this is not a current production transfer path.

#### BD-AUD-005 — Shared Supabase migration ledger and repository migration files are materially out of sync
- File: `docs/shared-supabase-migration-ledger-reconciliation.md`
- Evidence from the documented read-only snapshot (2026-11-09): 65 applied ledger entries vs 57 active root migration files; 21 exact version+name matches; 44 applied entries without an exact filename match; 36 repository files not represented by an exact applied version+name; two duplicate version prefixes.
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
- Evidence: the historical dedicated `aviator-api` implementation was archived by PR #148; the active function inventory contains the canonical `api` and `aviator-engine` functions, not a separately deployed `aviator-api`. No `aviator-api` requests appeared in the last 24-hour function-edge logs.
- Status: canonical routing was consolidated by PR #148. The remaining live deployment drift between deployed `api` version 36 and current main is separately tracked in #163.

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
- Status: resolved in main by PR #133 and the single-project cutover. `frontend/src/api/supabaseConfig.ts` now reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; hard-coded project/key fallbacks are no longer present. Issue #144 remains open only for confirming the Render build environment variables and live API/Realtime behavior.

#### BD-AUD-011 — Proxy health/readiness endpoints report process health, not upstream readiness
- File: `render-proxy.ts`
- Status: resolved in main by PR #136. `/health` is liveness; `/ready` performs a bounded, non-mutating Supabase Edge API health request and returns 503 when the upstream is unavailable. The deployed Render proxy's last observed live deploy remains older than current main and is not in the frontend's active request path.

#### BD-AUD-012 — API proxy buffers complete upstream responses and permits 40-second requests
- File: `render-proxy.ts`
- Status: resolved in main by PR #137. The proxy streams upstream response bodies, enforces a response-size cap, and bounds concurrent requests. The deployed Render proxy's observed live version is older than current main; the frontend currently calls Supabase Edge API directly.

#### BD-AUD-013 — CORS defaults to wildcard when explicit allowed origins are absent
- File: `supabase/functions/api/index.ts`
- Status: resolved in current main by PR #138; the canonical API uses an explicit origin allowlist without wildcard fallback. The deployed Supabase `api` v36 source still contains a conditional wildcard fallback when `BIGDADDY_ALLOWED_ORIGINS` is empty; that deployment-source mismatch is tracked in P1 issue #163. Whether the deployed fallback is active is unverified because environment values were not inspected.

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
- **BD-AUD-001 / BD-AUD-002 / BD-AUD-004:** PR #131 blocks the in-memory StorageEngine in production and removes eager production imports of seeded storage. Current Render/Express route-map inspection confirms the legacy wallet router is not mounted in the active production path.
- **BD-AUD-010 / BD-AUD-011 / BD-AUD-012 / BD-AUD-013:** PRs #133, #136, #137 and #138 add environment-based frontend config, upstream readiness, streaming/response caps, bounded proxy concurrency, and explicit Edge CORS origins. Current main is hardened; the deployed API source drift remains in #163 and Render env verification remains in #144.
- **BD-AUD-003 / BD-AUD-007:** PR #148 consolidates Aviator HTTP routing on the single active Supabase project, archives the inactive API/workers/migrations, and adds single-project regression tests. The deployed `api` function is still stale relative to current main; see #163.
- **BD-AUD-006 (partial):** PR #135 adds disposable PostgreSQL concurrent wallet-transfer/idempotency tests. PR #139 adds worker lease fault/expiry tests. Issue #127 remains open for concurrent Aviator cashout/settlement/refund and rollback-injection coverage.
- **BD-AUD-008 / BD-AUD-009 (partial):** PR #139 tests lease ownership and expiry. PR #146 adds per-round tick sequence, server timestamps, stale-event rejection, and Realtime lag/reconnect/polling-fallback diagnostics. Sequence-gap counters, missing-terminal-event cases, and mobile/staging E2E remain open.

### In progress / not applied to production
- **Legacy isolated Aviator implementation:** the eleven old migrations, four old Edge Functions, and redundant separate security/index candidate are archived under `supabase/archive/legacy-isolated-aviator/`; they are not part of the active CLI or deployment paths.
- **Migration ledger drift:** Issue #120 remains open. Single-project ledger: 65 applied versions vs 57 active root migration files (21 exact matches, 44 applied-only, 36 file-only, 2 duplicate prefixes). The eleven former isolated-project migrations, one separate security/index candidate, and four inactive Edge Functions are archived outside active Supabase CLI paths. PR #143/#146/#148 maintain the inventory manifest and CI guard. The remaining 65/57 drift is not yet reconciled.
- **Production Phase 1:** Issues #120 and #127 remain open for clean bootstrap/upgrade tests, migration provenance, concurrent financial flows, and rollback injection.
- **Frontend Vite environment:** the code migration is complete; issue #144 remains open until Render's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are independently confirmed and live API/Realtime behavior is tested.

## Recommended remediation order

1. Reconcile deployed Supabase `api` version 36 with reviewed main source under issue #163; add deployment-source parity evidence and a rollback plan before production rollout.
2. Complete API auth, validation, idempotency, and response contract tests on the canonical Aviator routes (BD-AUD-006/008).
3. Reconcile the single project's 65 applied migration effects against its 57 active source files and run clean-bootstrap/upgrade tests before any production migration push (BD-AUD-005).
4. Add concurrent Aviator cashout/settlement/refund tests and rollback injection, then run staging end-to-end financial flows (BD-AUD-006).
5. Complete Realtime sequence-gap/terminal-event coverage and mobile end-to-end validation (BD-AUD-008/009).
6. Move frontend Supabase URLs and publishable keys to validated Vite environment variables after Render workspace confirmation (BD-AUD-010–013).

## Audit limitations / evidence still required

- Static code review only; the complete 216-file tree was inventoried, and key production/runtime files were inspected, but not every line of every file was exhaustively reviewed.
- No production login, bet, cashout, settlement, wallet transfer, or refund was executed.
- No live database DDL, migration repair, schema mutation, or financial data change was performed.
- Render service/deploy metadata and Supabase live function logs were inspected; selected schemas/tables and aggregate financial invariants were checked read-only. Full Render deployment logs, a complete database catalog export, backup restore, and mobile end-to-end session remain unverified.
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


## Additional production recheck — 2026-11-10

### New findings and fixes
- #165 / PR #166: Roulette bet retries previously generated a new idempotency key after an ambiguous network failure. PR #166 implements a persisted, stable key scoped to user + round + canonical payload; all 7 CI jobs passed. Merge is held because the Render frontend auto-deploys from main and requires separate confirmation.
- #167: one production Aviator tick timed out in `realtime.send` while inserting into `realtime.messages` (SQLSTATE 57014), followed by an engine RPC failure and continuation 503. The worker lease is currently valid with a fresh heartbeat. Track timeout/backpressure/fault-injection work in #167.
- #168 / PR #169: the Aviator activation route was omitted from the explicit funded-pool guard and fell through to a generic activation path. PR #169 adds an explicit allowlist, verifies catalog/game-pool/wallet identity, requires positive available balance after reservations, checks the current Aviator round state, and fails closed for unknown games. Its current CI run is in progress; no production activation was performed.
- #163: deployed Supabase `api` version 36 (last updated 2026-10-24) differs materially from current main. No API 5xx responses were observed in the last 24-hour log window, but production source parity remains unresolved.
- Read-only financial invariants passed: total minted equals aggregate wallet balances; wallet balances match ledger-derived balances; Aviator reserved balance matches pending maximum liability; settled bets have settlement rows; the only single-entry transaction is the expected initial supply credit.
- The only open code PRs intended for main at this recheck are #152 (blocked migration restoration), #166 (CI passed, deployment gate), and #169 (activation guard, CI pending). PR #155 and #164 were merged; isolated-project PR #123 was closed as obsolete.

### Remaining release blockers
- Migration ledger/source drift remains 65 applied versions vs 57 active root migration files (21 exact matches, 44 applied-only, 36 source-only, two duplicate prefixes); PR #152 is not safe to merge.
- Production API deployment parity (#163), financial integration/concurrency/rollback tests (#127), and staging/mobile end-to-end evidence remain outstanding.
- No production Edge Function deployment, Render environment-variable change, migration repair, production DDL, wallet/bet/round mutation, game activation, or financial transaction was performed.
