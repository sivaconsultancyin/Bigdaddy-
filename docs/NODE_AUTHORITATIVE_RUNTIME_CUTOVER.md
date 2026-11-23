# Node.js authoritative game runtime cutover

**Status:** implementation branch; production cutover is deliberately gated.

## Target ownership

- Render Node.js backend owns all game round state machines, random outcome generation, multiplier progression, auto-cashout decisions, result visibility and settlement orchestration.
- Supabase PostgreSQL remains the durable source of truth for users, roles, rounds, bets, wallet ledger, idempotency and settlement transactions.
- Supabase atomic wallet functions remain the only financial transfer boundary. The Node process calls them inside database transactions.
- Supabase Realtime remains the event delivery path.
- Website and Android clients send game requests to the Node API. They never generate authoritative outcomes.

## What this branch changes

- Adds `start:backend` so Render can run `server.ts` as a dedicated Node web service while the existing static frontend remains separate.
- Routes game state, bet and cashout requests to `VITE_GAME_API_BASE_URL`; account, authentication, wallet and owner APIs remain on the canonical Supabase Edge API.
- Moves Aviator round progression and multiplier calculation into `backend/src/games/aviator/production.engine.ts`. It uses a fenced database lease, the existing atomic cashout/settlement functions, and Supabase Realtime broadcast.
- Adds a Node lifecycle supervisor for Roulette, Dice and Andar Bahar. It uses the same advisory-lock keys as the former SQL lifecycle functions, making the old Cron workers and Node worker mutually exclusive during a controlled cutover.
- Aligns Node result and settlement behavior with the persisted game rules: Roulette uses the committed seed plus round ID; Dice exact-number gross payout is 9x with 10x liability; Andar Bahar preserves 1.90x/2.00x side payouts and 1.95x Joker-color payouts.
- Hides non-Aviator outcomes from public state until settlement completes.
- Keeps the non-Aviator Node worker disabled by default using `AUTHORITATIVE_GAME_ENGINE_ENABLED=false`.

## Render configuration

The Blueprint defines:
- `bigdaddy-frontend`: existing static site, with `VITE_GAME_API_BASE_URL=https://bigdaddy-backend.onrender.com/api`.
- `bigdaddy-backend`: Node web service, Singapore region, health check `/api/health`, start command `npm run start:backend`.

Required backend environment variables:
- `APP_MODE=production`
- `NODE_ENV=production`
- `DATABASE_URL`: Supabase PostgreSQL connection URI.
- `DATABASE_POOLER_URL`: optional Supabase Session Pooler URI used only if direct connectivity fails.
- `CORS_ORIGINS=https://bigdaddy-frontend.onrender.com`
- `JWT_SECRET`: must be the exact same signing secret used by the Supabase Edge login/API token issuer; never create a different key for Node.
- `SESSION_SECRET`: the production session secret expected by the existing backend configuration.
- `AUTHORITATIVE_GAME_ENGINE_ENABLED=false` for initial deployment and API verification.

Secrets are intentionally marked manual in the Blueprint and are not stored in Git.

## Safe production cutover

**Do not perform these steps until the backend has deployed with valid secrets and API smoke tests pass.**

1. Deploy the Node API with `AUTHORITATIVE_GAME_ENGINE_ENABLED=false`. Do not stop any Supabase Cron jobs yet.
2. Verify `/api/health` and `/api/ready`, JWT compatibility, player-role enforcement, read-only state responses, bet idempotency and wallet error handling with an approved test account.
3. Verify the Aviator Node worker acquires the `aviator` lease, advances rounds and broadcasts the same multiplier. The 15-second Supabase watchdog must report that the lease is already owned rather than advancing a second round.
4. During a controlled cutover window, pause the three non-Aviator lifecycle Cron jobs:
   - `bigdaddy-dice-engine` (job 10)
   - `bigdaddy-roulette-engine` (job 11)
   - `bigdaddy-andar-bahar-engine` (job 12)
5. Set `AUTHORITATIVE_GAME_ENGINE_ENABLED=true` on the Render backend and redeploy/restart it. Confirm exactly one current round per active game and that round numbers progress once, not twice.
6. Run a controlled end-to-end test for each game: login, state read, bet, round result, settlement, wallet ledger and retry/idempotency. Confirm the server seed is not exposed before settlement and the reserved pool liability returns to zero for settled bets.
7. After Aviator Node operation is stable and recovery has been tested, disable the `bigdaddy-aviator-engine` watchdog Cron (job 5). Keep lease telemetry and database recovery checks available.
8. Monitor worker heartbeat, lease ownership, round age, pending bets, settlement lag, API latency and database connections. Keep the previous Cron definitions in Git and document the rollback sequence.

## Rollback

- If the Node non-Aviator worker fails before any round mutation, keep its flag false and resume the matching Supabase Cron job.
- If a round is in progress, do not start the old Cron worker until the Node worker has stopped and the advisory lock is released. Inspect the current round and pending bets first.
- Aviator fallback must not run while the Node lease is valid. Stop the Node process and confirm lease expiry/release before re-enabling the watchdog.
- Never manually edit balances, reserved balances, bet statuses or settlement rows to recover a failed cutover.

## Explicitly not done by this branch

- No production Supabase migration or wallet mutation is required for the code changes above.
- No Supabase Cron job has been paused or deleted.
- No Render service has been deployed or reconfigured yet; the Blueprint must be planned and its required secret values supplied securely before approval.
- CI/build/test results must be reviewed on the pull request before merge.
