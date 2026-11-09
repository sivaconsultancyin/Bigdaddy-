# BigDaddy production API and project boundary

Snapshot verified on 2026-11-10 using the repository source and read-only Supabase project inspection.

## Shared BigDaddy project

- Project ref: \`nzvpuoeibqrpcltrszvr\`
- Canonical general API: \`https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api\`
- The frontend routes login, wallet, account, and non-Aviator game requests to this API in production.
- The Render proxy's default upstream is also this API, but the frontend's production API client currently calls Supabase directly.
- The shared project currently has the \`api\` Edge Function active. Its general API handler also contains Aviator route code, but the browser client does not select it for the four isolated Aviator endpoints.

## Isolated Aviator project

- Project ref: \`yrleubhpiqejfvingqfj\`
- Project name/region: \`Bigdaddy aviator\`, \`ap-northeast-1\`
- Canonical Aviator API: \`https://yrleubhpiqejfvingqfj.supabase.co/functions/v1/aviator-api\`
- The frontend routes \`/games/aviator/state\`, \`history\`, \`bet\`, and \`cashout\` to this API.
- Read-only function inventory verified these active functions in the isolated project: \`aviator-api\`, \`aviator-wallet-worker\`, \`aviator-round-engine\`, and \`aviator-settlement-worker\`.

## Routing contract

\`frontend/src/api/client.ts\` is the client-side routing authority:

- Production non-Aviator endpoints use the shared BigDaddy API.
- The four Aviator endpoints above use the isolated Aviator API and its project publishable key.
- Realtime multiplier subscriptions in \`frontend/src/context/WebSocketContext.tsx\` use the shared project's Realtime endpoint.

These are intentionally separate Supabase projects, not a duplicate deployment of one function. Do not delete \`supabase/functions/aviator-api\`, remove its function config, or run a blanket deployment against the wrong project. Any deployment of isolated Aviator functions must explicitly target the isolated project ref.

## Migration directory safety

The root `supabase/migrations/` directory currently mixes shared-project SQL with eleven isolated-Aviator migration files. The shared project has 65 applied ledger versions; the isolated project has seven. Do not run a blanket `supabase db push` against either project until both ledgers and the per-project deployment workflow are reconciled. See `docs/shared-supabase-migration-ledger-reconciliation.md` and `supabase/aviator-migrations/README.md`.

## Other server entry points

- \`package.json\` starts \`render-proxy.ts\`.
- \`render-proxy.ts\` forwards to the shared \`/functions/v1/api\` endpoint.
- \`server.ts\` is a separate Express/PostgreSQL implementation with persistent production routers and a worker process. It is not the package's configured start entry point.
- The legacy in-memory wallet router is not mounted by \`server.ts\`'s production router list; \`StorageEngine\` now fails closed in production (see PR #131).

## Operational cautions

- Do not consolidate the two Supabase projects without a reviewed migration, wallet-operation, worker, and latency plan.
- Do not change Edge API CORS behavior until the live \`BIGDADDY_ALLOWED_ORIGINS\` secret is verified; the browser calls the shared Edge API directly in production.
- The client currently has project URLs and fallback publishable keys in source. Track migration to validated Vite environment variables separately; never place service-role keys in browser variables.
- This document records routing as inspected on the date above; re-check deployed function inventories and Render service configuration before any deployment change.
