# Migration Audit — Next Implementation Gate

## Scope inspected

Repository: `sivaconsultancyin/Bigdaddy-`  
Target branch: `main` after PR #48.

The repository has two SQL migration locations:

- `supabase/migrations/`: timestamped migration history, including initial schema, financial functions, Aviator pool reservation/idempotency fixes, authoritative game runtime, shared game pool, and later reservation restoration.
- `database/migrations/`: four numbered migrations. The first schema, wallet transfer, and hardening files have matching content hashes to files under `supabase/migrations/`, but this directory does not include the later timestamped changes seen in Supabase migrations.

`supabase/config.toml` exists and identifies project `bigdaddy-casino`. The root package scripts do not declare a database migration/deploy script. Therefore, `supabase/migrations` appears to be the current migration history, but the actual production deployment path must still be confirmed before schema DDL is run.

## High-priority finding: game pool is not the same thing as central player wallet

Migration `supabase/migrations/20261020140000_shared_game_pool.sql` updates every row in `public.game_pools` and every `public.games.pool_wallet_id` to the Aviator pool wallet. It also drops the unique constraint on `game_pools.wallet_id`.

This makes all catalog games share Aviator's pool, not merely the player's central wallet. That is a separate financial/product decision. A per-game-schema architecture can still have a single shared player wallet and separate game liability pools.

**Do not blindly reverse this migration.** Existing game pool balances, reserved liabilities, pending bets, and ledger history must be reconciled first. A reference-only change could direct games to empty pools; transferring funds without a reconciliation could double-count or misstate liabilities.

## Schema migration constraints

The existing financial functions are tightly coupled to `public.*` tables, including `wallet_transfer_atomic`, `place_crash_bet_atomic`, `cashout_crash_bet_atomic`, and `settle_crash_round_atomic`. The authoritative-game runtime also refers to `public.authoritative_game_rounds`, `public.authoritative_game_bets`, `public.wallets`, `public.games`, and the shared transfer function.

A schema-only table move would break these functions and application callers unless function bodies, argument/return types, grants, RLS, indexes, foreign keys, runtime checks, and worker queries are migrated together.

## Next safe implementation steps

1. Confirm the production migration mechanism and capture the deployed schema/version state.
2. Run read-only reconciliation for player wallet balances versus ledger, game pool balances versus ledger, all `reserved_balance` values versus open Aviator liabilities, and open bets/rounds.
3. Decide explicitly whether the game *pool* remains per-game or is intentionally shared. The chosen architecture only establishes a shared player wallet.
4. Add schemas and least-privilege roles in an additive migration; keep existing `public.*` objects live initially.
5. Move the wallet boundary and game tables in bounded, tested migrations; update SQL functions and application callers together.
6. Verify in staging with concurrent bet, duplicate idempotency key, cashout, settlement retry, and reconciliation tests before production cutover.

## Safety status

This audit document does not run SQL, modify production data, change wallet balances, or change API behavior. No claim is made that production migration status or current live balances have been verified.
