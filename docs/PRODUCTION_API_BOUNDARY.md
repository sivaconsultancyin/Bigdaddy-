# BigDaddy production API and Supabase project

Snapshot verified on 2026-11-10 using the repository source and read-only inspection of Supabase project `nzvpuoeibqrpcltrszvr`.

## Canonical production project

- Project ref: `nzvpuoeibqrpcltrszvr`
- Canonical API: `https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api`
- Canonical Aviator engine: `supabase/functions/aviator-engine`
- Aviator HTTP routes are part of the same `api` Edge Function in `supabase/functions/api/aviator.routes.ts`.
- The frontend sends login, wallet, account, all game, and Aviator state/history/bet/cashout requests to the same `API_BASE`.
- The Render proxy's default upstream is also the same `/functions/v1/api` endpoint. The production frontend currently calls Supabase directly.

## Verified live inventory

Read-only inspection on 2026-11-10 found:
- Active Edge Functions include `api` and `aviator-engine`; no separate `aviator-api`, wallet-outbox worker, round-engine, or settlement-worker is deployed.
- Live Aviator tables are `aviator.game_rounds`, `aviator.game_bets`, `aviator.game_settlements`, and `aviator.engine_worker_lease`.
- The current implementation uses shared wallet transactions and atomic RPCs. It does not use the archived isolated-project `aviator.wallet_operations` outbox model.
- The active `bigdaddy-aviator-engine` Cron job is configured in the same project.
- The live database contained existing round history. Do not drop/recreate the Aviator schema or replay the archived migrations.

## Routing contract

`frontend/src/api/client.ts` is the browser routing authority. All endpoints, including:
- `/games/aviator/state`
- `/games/aviator/history`
- `/games/aviator/bet`
- `/games/aviator/cashout`

must use the same `API_BASE`. No `VITE_AVIATOR_API_BASE_URL`, old project ref, or separate Aviator publishable key should remain in the runtime client.

The active function config should contain `[functions.api]` and `[functions.aviator-engine]`, not the abandoned isolated function entries. Legacy sources are retained under `supabase/archive/legacy-isolated-aviator/` for audit/history only and must never be deployed.

## Migration directory safety

The root `supabase/migrations/` directory now contains only the 57 candidate files for the single configured project. Eleven old isolated-project migrations and one separate security/index candidate have been moved outside the active CLI directory. The live project ledger has 65 applied entries; only 21 have an exact version+name source match, 44 applied entries have no exact file match, and 36 active source files are not represented by an exact applied version+name. Two duplicate version prefixes remain.

Do **not** run `supabase db push`, `migration repair`, or a blanket production deployment until the 65-entry live ledger and 57 source files are reconciled by SQL effect and tested against a disposable PostgreSQL database. See `docs/shared-supabase-migration-ledger-reconciliation.md`.

## Other server entry points

- `package.json` starts `render-proxy.ts`.
- `render-proxy.ts` forwards to the same canonical `/functions/v1/api` endpoint.
- `server.ts` is a separate Express/PostgreSQL implementation and is not the package's configured start entry point.
- The legacy in-memory wallet router is not mounted by the production router list; `StorageEngine` fails closed in production (see PR #131).

## Operational cautions

- Do not deploy the archived isolated Aviator functions or migrations.
- The frontend still has a hard-coded canonical Supabase URL; migration to validated Vite build-time environment variables remains tracked separately. Never place service-role keys in browser variables.
- No live migration, schema change, wallet balance change, bet settlement, round mutation, or scheduler change was made during this source-code reconciliation.
