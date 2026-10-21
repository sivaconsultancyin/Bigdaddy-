# BigDaddy Supabase Edge API migration

Target Supabase project: `nzvpuoeibqrpcltrszvr`
Target branch: `feature/supabase-data-api-migration`
Production policy: do not change Render traffic, merge to main, or deploy a frontend cutover until the regression gate is passed.

## Current verified state

- Active Supabase Edge Functions: `health`, `auth-login`, `auth-me`, and `api` (API router version 4 deployed).
- Feature-branch frontend API client and live-state polling point to `https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api` for production builds. Live-state polling now includes the BigDaddy bearer token and no longer falls back to Render in production; this branch has not been merged or deployed as the live frontend.
- Updated Edge Function CORS to allow `PUT` and the `Idempotency-Key` request header (needed for payment-details updates and bet/pool idempotency).
- The API router includes login/me, user listing/creation/referral registration, wallet reads/transfers/pool allocation, token requests, audit logs, Aviator state/history/bet/cashout, payment preferences, and state/bet routes for Roulette, Dice, Dragon Tiger, and Andar Bahar. These routes still need contract/regression tests.
- Existing BigDaddy JWT is a custom HS256 token; Edge Functions must use the same `BIGDADDY_JWT_SECRET` as the current backend. Never expose the secret to the browser or commit it.
- Existing database schemas inspected: `platform`, `wallet`, `aviator`, `roulette`, `dice`, `dragon_tiger`, and `andar_bahar`. The `teen_patti` schema is absent in the target project.
- Two migrations added and applied for atomic user creation/referral registration and atomic authoritative-game bets/token-request resolution.
- No production frontend cutover has been made. External HTTP testing could not be completed from this environment; active deployment status and SQL function existence were verified. Security advisors still report RLS-enabled game tables with no policies; keep them inaccessible to public roles and review grants before exposing any table through the Data API.

## Endpoint inventory

### Authentication
- [x] `POST /auth/login` -> Edge Function `auth-login` (active; end-to-end login still needs testing)
- [x] `GET /auth/me` -> Edge Function `auth-me` (active; end-to-end testing still needed)
- [x] `POST /auth/register-referral` -> `api` (needs end-to-end tests)
- [x] `POST /auth/create-user` -> `api` + atomic RPC (needs end-to-end tests)
- [x] `GET /auth/users` -> `api` (needs role-scope tests)
- [x] `GET /auth/admin-payment-info` -> `api` using profile preferences (needs compatibility review)
- [x] `PUT /auth/payment-details` -> `api` using profile preferences (needs compatibility review)

### Configuration, wallet, requests, audit
- [x] `GET /config`
- [x] `GET /wallet/my-wallet`
- [x] `GET /wallet/summary`
- [x] `GET /wallet/ledger`
- [x] `POST /wallet/transfer`
- [x] `POST /wallet/game-pool`
- [x] `POST /requests/create`
- [x] `GET /requests/list`
- [x] `POST /requests/:id/approve` + `POST /requests/:id/reject` -> atomic RPC
- [x] `GET /audit/logs`

### Game APIs
- [x] `GET /games/list`
- [x] `POST /games/:gameCode/activate`
- [x] `GET /games/aviator/state` + `GET /games/aviator/history`
- [x] `POST /games/aviator/bet`
- [x] `POST /games/aviator/cashout`
- [x] `GET /games/roulette/state`
- [x] `POST /games/roulette/spin` + `POST /games/roulette/bet`
- [ ] `GET /games/teen-patti/state`
- [ ] `POST /games/teen-patti/boot`
- [ ] `POST /games/teen-patti/action`
- [x] `GET /games/andar-bahar/state` + `POST /games/andar-bahar/bet`
- [x] `GET /games/dragon-tiger/state` + `POST /games/dragon-tiger/bet`
- [x] `GET /games/dice/state` + `POST /games/dice/bet` + `POST /games/dice/roll`
- [ ] `POST /games/dice/verify`

## Required migration safeguards

1. Port each endpoint's validation, role/ownership checks, response shape, audit events, and error mapping.
2. Keep all wallet/bet/payout changes atomic in PostgreSQL RPCs/transactions; never implement money movement as separate client-side writes.
3. Verify idempotency for retries, especially bet, cashout, transfers, and approvals.
4. Port or replace the live game worker/realtime event source; REST state endpoints alone do not replace the existing live engine.
5. Test CORS, JWT expiry/role freshness, inactive users, and every role boundary.
6. Keep Render as rollback target while testing on the feature branch.
7. Only after every required endpoint and realtime flow passes tests, change frontend API routing and request explicit approval before production cutover.

## Current blocker / honest status

The shared API router is deployed and the feature-branch frontend is configured to use it, but the migration is not complete. Teen Patti storage/routes and Dice verification are not implemented; game-round creation, live settlement/worker behavior and the full realtime lifecycle still need migration. Core API handlers have not yet passed end-to-end HTTP regression tests. Do not merge/deploy the frontend or enable financial gameplay until those gaps are closed.
