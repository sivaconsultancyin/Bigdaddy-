# Schema Cutover Runbook (Staging First)

## Current state

The namespace-preparation migration creates `platform`, `wallet`, and per-game schemas, but existing tables and runtime SQL still live in `public`. The `wallet.wallet_transfer_atomic` function is currently a compatibility wrapper around `public.wallet_transfer_atomic`; it is not evidence that the tables have been moved.

## Safety rules

- Do not run a table move against production until the same migration has passed on a recent staging clone and the cutover gates below are green.
- Do not assume a shared player wallet means a shared game pool. The historical `20261020140000_shared_game_pool.sql` maps catalog games to the Aviator pool wallet. Preserve each wallet's balance and reserved balance; do not transfer, reset, or mint funds as part of a schema move.
- Freeze new bets and settlements during the final cutover window. Wait until no round/bet is in a state that requires live settlement, or use an explicitly tested dual-write/compatibility strategy.
- Take and verify a recoverable database backup before any DDL/data changes.

## Read-only preflight

Run `scripts/db/schema-cutover-preflight.sql` against staging first. Save its output as the baseline. Investigate every duplicate pool mapping, missing wallet, negative available balance, reservation exceeding balance, open bet/round, and non-zero ledger transaction net before proceeding.

## Required migration order

1. Capture counts, primary keys, constraints, indexes, grants, RLS policies, triggers, function definitions, and dependencies for all tables/functions in scope.
2. Decide and document pool ownership per game. Shared player wallet and game-pool ownership are separate decisions.
3. Move or recreate identity objects in `platform`, wallet/ledger objects in `wallet`, and each game's round/bet tables in its game schema. Preserve enum/type dependencies, foreign keys, indexes, triggers, policies, ownership, grants, and sequence/default behavior.
4. Recreate financial and settlement functions with schema-qualified names and a hardened `search_path`. Keep compatibility entry points until every API and worker has switched and passed tests.
5. Update API routes, background engines, worker processes, health checks, and any admin/reporting SQL. Search for all remaining `public.` references and classify each one as intentional or outstanding.
6. Apply the migration to staging; run migration repeatability, API contract tests, concurrent idempotency tests, wallet/ledger invariants, bet/cashout/settlement/restart-recovery tests, and a rollback rehearsal.
7. Compare before/after row counts, primary-key sets, wallet balances, reserved balances, pool mappings, open bets, transaction counts, ledger net, and token-supply invariant.
8. Cut over production only after explicit operator approval, verified backup, a maintenance/freeze window, and a tested rollback plan. Run the same reconciliation immediately after cutover.

## Stop conditions

Stop and roll back if any wallet balance or reservation changes unexpectedly; a ledger transaction is unbalanced; an open bet or round is missing; any foreign key/index/policy/function grant is lost; or any runtime process still relies on an unverified legacy path.

## Environment boundary

Repository CI's PostgreSQL fixtures are intentionally minimal and do not represent a real Supabase project. CI passing is not a staging or production database test. This repository change does not connect to or modify either database.


## Dependency inventory (before writing a move migration)

Run `scripts/db/schema-dependency-inventory.sql` on the same staging clone and retain its output with the preflight baseline. It reports target table columns and enum/domain types, constraints and inbound/outbound foreign keys, non-internal triggers, RLS flags/policies, table/schema grants, candidate financial/game function definitions, dependent views, and type dependencies. Review these results before deciding whether each object can move directly or must be recreated in dependency order.

This inventory is deliberately read-only. It does not prove that production/staging is reconciled, and it does not perform a schema cutover. In particular, `authoritative_game_bets` and `authoritative_game_rounds` contain multiple game codes in the current design; a per-game schema migration must split/copy rows by game_code and preserve IDs and foreign-key relationships rather than blindly moving the shared tables.
