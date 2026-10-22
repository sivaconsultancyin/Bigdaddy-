# BigDaddy API Route Inventory and Supabase Edge Migration

Last reviewed: 2026-10-22

## Target architecture

- Frontend: Render static/web frontend.
- Production API: Supabase Edge Function `api` at `/functions/v1/api`.
- Persistent data: Supabase PostgreSQL.
- Production frontend code must use the Supabase API base; `VITE_API_BASE_URL` is only a development/preview override.

## Express backend route inventory

Routes mounted in `server.ts` in production:

| Method | Route | Supabase Edge status |
|---|---|---|
| GET | `/api/health` | Implemented as `GET /health` |
| GET | `/api/ready` | Implemented as `GET /ready` |
| GET | `/api/config` | Implemented as `GET /config` |
| GET | `/api/monitoring/failures` | **Not migrated**; current monitor uses in-process health-failure data |
| POST | `/api/auth/login` | Implemented as `POST /auth/login` |
| POST | `/api/auth/register-referral` | Implemented as `POST /auth/register-referral` |
| GET | `/api/auth/me` | Implemented as `GET /auth/me` |
| GET | `/api/auth/users` | Implemented as `GET /auth/users` |
| POST | `/api/auth/create-user` | Implemented as `POST /auth/create-user` |
| POST | `/api/auth/bootstrap-owner` | Intentionally not exposed as a public Edge route; owner bootstrap must remain a controlled administrative operation |
| GET | `/api/wallet/my-wallet` | Implemented as `GET /wallet/my-wallet` |
| GET | `/api/wallet/summary` | Implemented as `GET /wallet/summary` |
| GET | `/api/wallet/ledger` | Implemented as `GET /wallet/ledger` |
| POST | `/api/wallet/transfer` | Implemented as `POST /wallet/transfer` |
| POST | `/api/wallet/game-pool` | Implemented as `POST /wallet/game-pool` |
| GET | `/api/games/list` | Implemented as `GET /games/list` |
| POST | `/api/games/:gameCode/activate` | Implemented as `POST /games/:gameCode/activate` |
| GET | `/api/games/aviator/state` | Implemented as `GET /games/aviator/state` |
| GET | `/api/games/aviator/history` | Implemented as `GET /games/aviator/history` |
| POST | `/api/games/aviator/bet` | Implemented as `POST /games/aviator/bet` |
| POST | `/api/games/aviator/cashout` | Implemented as `POST /games/aviator/cashout` |
| GET | `/api/requests/list` | Implemented as `GET /requests/list` |
| POST | `/api/requests/create` | Implemented as `POST /requests/create` |
| POST | `/api/requests/:id/approve` | Implemented as `POST /requests/:id/approve` |
| POST | `/api/requests/:id/reject` | Implemented as `POST /requests/:id/reject` |
| GET | `/api/games/:gameCode/state` | Implemented for the authoritative whitelist: roulette, dice, dragon-tiger, andar-bahar |
| POST | `/api/games/:gameCode/bet` | Implemented for the authoritative whitelist: roulette, dice, dragon-tiger, andar-bahar |
| GET | `/api/audit/logs` | Implemented as `GET /audit/logs` |

The Express production server deliberately returns 503 for unsupported legacy game routers and the legacy audit router. A route file existing in the repository does not mean that route is enabled in production.

## Frontend API calls

`frontend/src/api/client.ts` uses the single Supabase API base in production:
`https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api`

The frontend calls auth, wallet, token-request, games, audit, and game-action paths relative to this base. The base change does not automatically make every endpoint functional; the endpoint's Edge handler and database schema/RPC must also exist.

## Additional frontend paths and migration gaps

| Frontend call | Current status |
|---|---|
| `GET /auth/admin-payment-info` | Edge handler exists |
| `PUT /auth/payment-details` | Edge handler exists |
| `GET /games/roulette/state`, `POST /games/roulette/bet`, `POST /games/roulette/spin` | Edge handler exists through authoritative-game state/bet routes |
| `GET /games/dice/state`, `POST /games/dice/bet` | Edge handler exists through authoritative-game state/bet routes |
| `POST /games/dice/roll` | Only supports the authoritative bet payload shape (`bets` array); the UI's alternate slider/target payload needs a separate persistent implementation before claiming parity |
| `POST /games/dice/verify` | Implemented in Edge Function as stateless HMAC/SHA-256 verification |
| `GET /games/andar-bahar/state`, `POST /games/andar-bahar/bet` | Edge handler exists through authoritative-game state/bet routes |
| `GET /games/dragon-tiger/state`, `POST /games/dragon-tiger/bet` | Edge handler exists through authoritative-game state/bet routes |
| `GET /games/teen-patti/state`, `POST /games/teen-patti/boot`, `POST /games/teen-patti/action` | Not migrated; the existing implementation is in-memory and not mounted by the production Express server. Do not port it as-is for a financial game; it needs persistent, atomic settlement first |
| `GET /monitoring/failures` | Not migrated; requires a persistent health-events store or a separate observability design |

## Safety and rollout checklist

- [x] Inventory the production Express routes and frontend API calls.
- [x] Point production frontend requests to the Supabase Edge Function base.
- [x] Add the stateless Dice verification endpoint to the Supabase `api` function.
- [ ] Add a persistent monitoring-failures endpoint.
- [ ] Implement and test the Dice slider/target mode using persistent atomic wallet settlement, or remove that mode from the frontend until supported.
- [ ] Design and implement Teen Patti with persistent tables/RPCs, idempotency, and atomic settlement before enabling its UI.
- [ ] Run production smoke tests for login, role checks, wallet, requests, game state/bets, and Aviator settlement.
- [ ] Verify Render frontend deploy and remove any dashboard-level production API override that points back to the Render backend.
- [ ] Only then consider retiring the old Render backend service.

Never put the Supabase service-role key or JWT signing secret in frontend code.

## Production smoke-test evidence (2026-10-22)

A safe live HTTP smoke pass was run against the deployed api Edge Function using the database pg_net HTTP client. No wallet transfers, user creation, token-request writes, or bets were executed.

| Check | Result |
|---|---|
| GET /health | PASS — HTTP 200; databaseConnected=true |
| GET /config | PASS — HTTP 200; apiBackend=supabase |
| POST /auth/login with malformed input | PASS — HTTP 400 validation response |
| POST /auth/login with a syntactically valid but nonexistent username | PASS — HTTP 401 invalid credentials |
| GET /auth/me without a BigDaddy token | PASS — HTTP 401 AUTH_REQUIRED |
| GET /wallet/my-wallet without a BigDaddy token | PASS — HTTP 401 AUTH_REQUIRED |
| GET /requests/list without a BigDaddy token | PASS — HTTP 401 AUTH_REQUIRED |
| POST /auth/create-user without a BigDaddy token | PASS — HTTP 401 AUTH_REQUIRED |
| POST /auth/login with JSON null body (version 12) | PASS — HTTP 400 INVALID_JSON; no unhandled exception |
| POST /auth/register-referral with JSON null body (version 12) | PASS — HTTP 400 INVALID_JSON; no unhandled exception |
| POST /games/dice/verify with JSON null body (version 12) | PASS — HTTP 400 INVALID_JSON; no unhandled exception |

Earlier live logs from Edge API version 10 showed HTTP 200 for authenticated /auth/me, /auth/users, /wallet/my-wallet, /wallet/summary, /wallet/ledger, and /requests/list. The current deployed API is version 12. Version-11 logs showed repeated 503s on login, referral registration, and user creation when the request body was JSON null. Version 12 now rejects null/non-object JSON bodies with HTTP 400 across all 12 JSON-parsing handlers; live tests of null bodies on login, referral registration, and Dice verification returned 400 without the prior exception. Valid-credential login and authorized write flows were not executed in production because no approved test credentials/token were available and those flows can write audit/user/wallet/request data. Do not consider successful login or user creation certified until the valid-login test below passes.

### Repeatable smoke runner

Run from the repository root in a trusted environment. Do not commit credentials or tokens.

```sh
SUPABASE_PUBLISHABLE_KEY='your-public-publishable-key' \
BIGDADDY_SMOKE_USERNAME='approved-test-account' \
BIGDADDY_SMOKE_PASSWORD='test-account-password' \
node scripts/supabase-edge-smoke.mjs
```

If an approved short-lived BigDaddy token is available, set BIGDADDY_SMOKE_TOKEN instead of the username/password pair to test read-only profile, wallet, ledger, and request-list endpoints. A valid login writes the normal USER_LOGIN audit event. The runner never creates users or token requests and never transfers tokens or places bets.
