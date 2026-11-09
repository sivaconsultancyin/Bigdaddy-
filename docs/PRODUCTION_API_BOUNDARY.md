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

## Aviator implementation differences that still need parity work

The shared API and isolated Aviator API are both active for different project responsibilities. Their internal implementations are not identical:

- Shared API bet/cashout routes call `place_crash_bet_authenticated_atomic` and `cashout_crash_bet_authenticated_atomic`.
- Isolated Aviator API calls `create_bet_intent` and `cashout_bet_intent` in its own project after validating the BigDaddy token against the shared project's current user/role records.
- The frontend sends the four Aviator endpoints to the isolated project; the shared API still contains Aviator routes for compatibility/other clients.

Do not assume these paths are behaviorally equivalent. Issue #126 remains open for request/response, authorization, idempotency, and settlement contract tests across both implementations.

## Other server entry points

- \`package.json\` starts \`render-proxy.ts\`.
- \`render-proxy.ts\` forwards to the shared \`/functions/v1/api\` endpoint.
- \`server.ts\` is a separate Express/PostgreSQL implementation with persistent production routers and a worker process. It is not the package's configured start entry point.
- The legacy in-memory wallet router is not mounted by \`server.ts\`'s production router list; \`StorageEngine\` now fails closed in production (see PR #131).

## Operational cautions

- Do not consolidate the two Supabase projects without a reviewed migration, wallet-operation, worker, and latency plan.
- Do not change Edge API CORS behavior until the live \`BIGDADDY_ALLOWED_ORIGINS\` secret is verified; the browser calls the shared Edge API directly in production.
- The client still contains project URL defaults and fallback publishable keys in source. Move these to validated Vite environment variables after the Render workspace environment is inspected; never place service-role keys in browser variables.
- This document records routing as inspected on the date above; re-check deployed function inventories and Render service configuration before any deployment change.
