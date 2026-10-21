# Database Schema Separation and Central Wallet Migration

## Decision

- Keep one PostgreSQL/Supabase database.
- Keep one player wallet per user, shared by all games.
- Place wallet accounts, wallet transactions, and the double-entry ledger behind one wallet-owned database/API boundary.
- Give each game its own schema: `aviator`, `roulette`, `dice`, `dragon_tiger`, `andar_bahar`, and `teen_patti`.
- Keep identity and shared configuration in `platform`.
- Do not treat schema separation as a hard isolation boundary; use database roles, grants, and non-exposed schemas as well.

**Important distinction:** a central *player wallet* does not require a single shared *game pool*. Keep per-game pool accounting separate unless a separate product decision explicitly requires pooled liabilities. The current `20261020140000_shared_game_pool.sql` migration points every catalog game at the Aviator pool; that must be reviewed before rollout because it couples game liabilities.

## Current repository facts

- `backend/src/db/postgres.ts` creates main, auth, and engine pools from the configured database URL.
- `backend/src/routes/production.routes.ts` and `backend/src/games/aviator/production.engine.ts` use qualified `public.*` names, including `wallets`, `ledger_entries`, `games`, `game_rounds`, and wallet/crash functions.
- `backend/src/routes/authoritative-games.routes.ts` uses `public.authoritative_game_rounds`, `public.authoritative_game_bets`, `public.games`, `public.wallets`, and wallet transfer functions for Roulette, Dice, Dragon Tiger, and Andar Bahar.
- The repository also contains Teen Patti routes, so it must be included in the game inventory even though it is not currently in the authoritative game-code list.
- SQL functions in existing migrations have explicit `public.*` references and function-level grants/search paths. Moving tables alone would break runtime behavior.
- The repository has both `database/migrations` and `supabase/migrations`; the migration history/source of truth must be confirmed before adding production schema changes.

## Target schema ownership

| Schema | Owns |
|---|---|
| `platform` | users, profiles, role assignments, referral codes, sessions, audit logs, game catalog/configuration |
| `wallet` | wallets, wallet transactions, ledger entries, token supply, wallet transfer/reserve/release/payout/refund functions |
| `aviator` | crash rounds, bets, settlements, crash-specific engine state |
| `roulette` | roulette rounds, bets, results |
| `dice` | dice rounds, bets, results |
| `dragon_tiger` | Dragon Tiger rounds, bets, results |
| `andar_bahar` | Andar Bahar rounds, bets, results |
| `teen_patti` | Teen Patti round/bet/settlement state, after its persistence model is audited |

Shared IDs should retain their existing UUID values during migration. Cross-schema foreign keys may be retained because all schemas live in the same PostgreSQL database.

## Required implementation sequence

1. **Inventory before DDL:** enumerate every table, type, sequence, index, trigger, policy, grant, function, and call site from both migration directories. Confirm which migration directory is actually deployed. Capture production schema state and backup/restore instructions.
2. **Define wallet API boundary:** expose typed server-side operations for reserve/place-bet, release/refund, payout/settle, and transfer. Require idempotency keys, reject key reuse with different parameters, and return the original result for a matching replay.
3. **Create target schemas and roles:** create non-exposed schemas and least-privilege database roles. Game roles must not have direct write permission on wallet balances or ledger tables. Keep credentials server-side; never ship database secrets in the APK/frontend.
4. **Compatibility migration:** add target structures and move/copy data with explicit foreign-key, index, enum/type, RLS, trigger, and function handling. Do not drop the existing `public.*` structures until every caller and worker is cut over and reconciliation passes.
5. **Update code by bounded slice:** migrate the wallet boundary first, then Aviator engine/routes, then each authoritative game, then Teen Patti. Update `aviator-worker.ts`, runtime checks, search paths, and grants along with SQL references.
6. **Verify before cutover:** compare row counts and UUIDs; reconcile wallet balances against ledger entries; verify reserved liabilities and open bets/rounds; test rollback on a staging database.
7. **Canary and cleanup:** enable one game at a time. Keep rollback instructions and old structures until monitoring confirms successful bets, cashouts, payouts, refunds, worker restart recovery, and idempotent retries. Remove compatibility objects only in a later migration.

## Release-blocking tests

- Duplicate and concurrent bet requests with the same idempotency key.
- Same key reused with different user/round/amount is rejected.
- Two games placing bets concurrently against one player wallet cannot overspend it.
- Bet reservation, game settlement, payout/refund, and ledger entries remain atomic.
- Engine/worker crash and retry do not double-settle.
- Unauthorized roles cannot write wallet/ledger tables or invoke privileged financial functions.
- RLS, grants, and schema exposure are verified for Supabase Data API roles.
- Financial reconciliation succeeds before and after the migration.

## Not included in this preparation change

This document does not alter production data, move tables, change balances, or change API behavior. The schema move must be implemented only after the deployed migration source of truth and full SQL dependency inventory are confirmed; otherwise the current explicit `public.*` references and financial functions can fail at runtime.
