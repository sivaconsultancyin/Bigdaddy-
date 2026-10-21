# BigDaddy Supabase Edge API migration

Target Supabase project: `nzvpuoeibqrpcltrszvr`
Target branch: `feature/supabase-data-api-migration`
Production policy: do not change Render traffic, merge to main, or deploy a frontend cutover until the regression gate is passed.

## Current verified state

- Active Supabase Edge Functions: `health`, `auth-login`, `auth-me`.
- Frontend API client: `frontend/src/api/client.ts` currently defaults to `https://bigdaddy-backend.onrender.com/api` in production.
- Existing BigDaddy JWT is a custom HS256 token; Edge Functions must use the same `BIGDADDY_JWT_SECRET` as the current backend. Never expose the secret to the browser or commit it.
- Existing database schemas inspected: `platform`, `wallet`, `aviator`. Other game tables/engines must be verified before porting those endpoints.
- No frontend cutover has been made.

## Endpoint inventory

### Authentication
- [x] `POST /auth/login` -> Edge Function `auth-login` (active; end-to-end login still needs testing)
- [x] `GET /auth/me` -> Edge Function `auth-me` (active; end-to-end testing still needed)
- [ ] `POST /auth/register-referral`
- [ ] `POST /auth/create-user`
- [ ] `GET /auth/users`
- [ ] `GET /auth/admin-payment-info`
- [ ] `PUT /auth/payment-details`

### Configuration, wallet, requests, audit
- [ ] `GET /config`
- [ ] `GET /wallet/my-wallet`
- [ ] `GET /wallet/summary`
- [ ] `GET /wallet/ledger`
- [ ] `POST /wallet/transfer`
- [ ] `POST /wallet/game-pool`
- [ ] `POST /requests/create`
- [ ] `GET /requests/list`
- [ ] `POST /requests/:id/approve`
- [ ] `POST /requests/:id/reject`
- [ ] `GET /audit/logs`

### Game APIs
- [ ] `GET /games/list`
- [ ] `POST /games/:gameCode/activate`
- [ ] `GET /games/aviator/state`
- [ ] `POST /games/aviator/bet`
- [ ] `POST /games/aviator/cashout`
- [ ] `GET /games/roulette/state`
- [ ] `POST /games/roulette/spin`
- [ ] `POST /games/roulette/bet`
- [ ] `GET /games/teen-patti/state`
- [ ] `POST /games/teen-patti/boot`
- [ ] `POST /games/teen-patti/action`
- [ ] `GET /games/andar-bahar/state`
- [ ] `POST /games/andar-bahar/bet`
- [ ] `GET /games/dragon-tiger/state`
- [ ] `POST /games/dragon-tiger/bet`
- [ ] `GET /games/dice/state`
- [ ] `POST /games/dice/roll`
- [ ] `POST /games/dice/bet`
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

This is an inventory and cutover checklist, not a claim that all APIs have been migrated. Only the two auth endpoints above currently have active Edge Functions. Do not change the frontend API base to Supabase until the remaining endpoints and realtime/game engines are implemented and tested.
