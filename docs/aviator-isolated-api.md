# Aviator isolated API

The `aviator-api` Edge Function is a read-only first phase for state/history. It deliberately does not handle bets or cashout until the shared-wallet service contract and pool-liability reservation are implemented and tested.

## Required secrets on the target Aviator Supabase project

- `BIGDADDY_SHARED_SUPABASE_URL`: URL of the shared BigDaddy source project.
- `BIGDADDY_SHARED_SERVICE_ROLE_KEY`: service-role key for shared auth lookup only.
- `BIGDADDY_JWT_SECRET`: the same HS256 secret used by the current BigDaddy API.
- `BIGDADDY_ALLOWED_ORIGINS`: optional comma-separated allowed frontend origins.

The target project supplies its own `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Routes

- `GET /functions/v1/aviator-api/games/aviator/state`
- `GET /functions/v1/aviator-api/games/aviator/history`

Both routes verify the existing BigDaddy JWT and then re-check that the user is active and has exactly one current role assignment in the shared source project. Game data comes from the isolated Aviator database.

## Not yet implemented

Bet, cashout, auto-cashout and crash settlement are intentionally not exposed by this function. Do not point production frontend traffic to it until the wallet-operation service and engine are deployed and integration-tested.
