# Shared BigDaddy Supabase migration ledger reconciliation

Read-only snapshot taken 2026-11-09. GitHub main commit: `aaef4f728e5e4c17fa05a2690306577f2585e465`. Target project: shared BigDaddy (`nzvpuoeibqrpcltrszvr`).

## Exact comparison

- Applied ledger entries: **65**
- SQL files in `supabase/migrations/`: **55**
- Exact version + name matches: **21**
- Applied ledger entries with no exact file match: **44**
- GitHub SQL files not represented by an exact applied version + name: **34**
- Duplicate filename version prefixes: **2**

A name-only comparison is insufficient. A file with the same migration name but a different 14-digit version is still a pending file to the Supabase CLI and can be replayed. Do not run `supabase db push`, `migration repair`, or rename/replay files until each row has an approved source/effect mapping.

## Applied ledger entries without an exact GitHub file

| Applied version | Applied name | Same-name file candidate (not verified as identical) |
|---|---|---|
| `20261020031459` | `authoritative_game_runtime` | `20261020120000_authoritative_game_runtime.sql` |
| `20261020034914` | `use_one_shared_game_pool` | No same-name file found |
| `20261020072454` | `harden_aviator_bet_idempotency` | `20261020150000_harden_aviator_bet_idempotency.sql` |
| `20261020082549` | `restore_aviator_pool_reservations` | `20261020170000_restore_aviator_pool_reservations.sql` |
| `20261021073604` | `prepare_game_schema_isolation` | `20261021100000_prepare_game_schema_isolation.sql` |
| `20261021074007` | `harden_wallet_transfer_idempotency` | `20261021110000_harden_wallet_transfer_idempotency.sql` |
| `20261021074016` | `wallet_transfer_api_boundary` | `20261021120000_wallet_transfer_api_boundary.sql` |
| `20261021075943` | `move_platform_wallet_aviator_tables` | `20261021130000_move_platform_wallet_aviator_tables.sql` |
| `20261021080013` | `split_authoritative_games_by_schema` | `20261021140000_split_authoritative_games_by_schema.sql` |
| `20261021090243` | `add_system_health_events` | `20261021160000_add_system_health_events.sql` |
| `20261021105932` | `enable_rls_system_health_events` | No same-name file found |
| `20261021110411` | `protect_reserved_wallet_balances` | `20261021120000_protect_reserved_wallet_balances.sql` |
| `20261021110835` | `fix_wallet_token_supply_invariant` | `20261021163700_fix_wallet_token_supply_invariant.sql` |
| `20261021111016` | `harden_aviator_cashout_idempotency` | `20261021165000_harden_aviator_cashout_idempotency.sql` |
| `20261021112046` | `limit_aviator_bet_idempotency_key_length` | `20261021171000_limit_aviator_bet_idempotency_key_length.sql` |
| `20261021112226` | `validate_aviator_bet_user_and_round` | `20261021173000_validate_aviator_bet_user_and_round.sql` |
| `20261021112352` | `harden_aviator_bet_function_search_path` | `20261021175000_harden_aviator_bet_function_search_path.sql` |
| `20261021115840` | `add_authoritative_game_bet_and_request_rpcs` | No same-name file found |
| `20261021120305` | `add_atomic_user_creation_rpcs` | `20261021193000_add_atomic_user_creation_rpcs.sql` |
| `20261021131844` | `expose_backend_schemas_to_postgrest` | `20261021200000_expose_backend_schemas_to_postgrest.sql` |
| `20261021132931` | `refresh_postgrest_custom_schema_cache` | No same-name file found |
| `20261021161239` | `harden_aviator_cashout_settlement_search_path` | `20261021180000_harden_aviator_cashout_settlement_search_path.sql` |
| `20261021161812` | `harden_public_compatibility_views_rls` | No same-name file found |
| `20261021181244` | `enable_pg_cron` | No same-name file found |
| `20261021182703` | `enable_pg_net_for_aviator_engine` | No same-name file found |
| `20261021184042` | `pause_aviator_engine_scheduler_for_auth_debug` | No same-name file found |
| `20261021185943` | `restore_aviator_engine_scheduler` | No same-name file found |
| `20261021190040` | `verify_aviator_engine_secret_against_vault` | No same-name file found |
| `20261021190059` | `pause_aviator_scheduler_until_auth_fixed` | No same-name file found |
| `20261022192457` | `reduce_aviator_round_cooldown_to_4_seconds` | `20261023100000_reduce_aviator_round_cooldown_to_4_seconds.sql` |
| `20261023093157` | `allow_concurrent_aviator_cashouts` | `20261023110000_allow_concurrent_aviator_cashouts.sql` |
| `20261023093446` | `harden_concurrent_aviator_cashout_timing` | `20261023120000_harden_concurrent_aviator_cashout_timing.sql` |
| `20261023101542` | `aviator_cashout_single_authenticated_rpc` | `20261023160000_aviator_cashout_single_authenticated_rpc.sql` |
| `20261023111617` | `roulette_durable_round_lifecycle` | No same-name file found |
| `20261023111733` | `roulette_lifecycle_pgcrypto_and_result_hold_fix` | No same-name file found |
| `20261023111952` | `roulette_escrow_stake_settlement` | `20261023140000_roulette_escrow_stake_settlement.sql` |
| `20261023112228` | `roulette_persist_spin_phase` | `20261023150000_roulette_persist_spin_phase.sql` |
| `20261023112431` | `roulette_database_bet_selection_validation` | No same-name file found |
| `20261023115040` | `roulette_hash_integer_overflow` | `20261023170000_roulette_hash_integer_overflow.sql` |
| `20261023175014` | `aviator_realtime_broadcast` | `20261023190000_aviator_realtime_broadcast.sql` |
| `20261107193251` | `refund_stale_waiting_aviator_bets` | No same-name file found |
| `20261107193319` | `fix_aviator_stale_bet_refund_audit` | No same-name file found |
| `20261107193342` | `fix_aviator_refund_count` | No same-name file found |
| `20261109163549` | `aviator_realtime_and_recovery_hardening` | `20261109090000_aviator_realtime_and_recovery_hardening.sql` |

## GitHub files not represented by an exact applied ledger entry

| File version | File name |
|---|---|
| `20261018000000` | `20261018000000_initial_schema.sql` |
| `20261019170000` | `20261019170000_fix_crash_pool_reservation_release.sql` |
| `20261019171000` | `20261019171000_validate_wallet_idempotency_reuse.sql` |
| `20261020120000` | `20261020120000_authoritative_game_runtime.sql` |
| `20261020140000` | `20261020140000_shared_game_pool.sql` |
| `20261020150000` | `20261020150000_harden_aviator_bet_idempotency.sql` |
| `20261020170000` | `20261020170000_restore_aviator_pool_reservations.sql` |
| `20261021100000` | `20261021100000_prepare_game_schema_isolation.sql` |
| `20261021110000` | `20261021110000_harden_wallet_transfer_idempotency.sql` |
| `20261021120000` | `20261021120000_protect_reserved_wallet_balances.sql` |
| `20261021120000` | `20261021120000_wallet_transfer_api_boundary.sql` |
| `20261021130000` | `20261021130000_move_platform_wallet_aviator_tables.sql` |
| `20261021140000` | `20261021140000_split_authoritative_games_by_schema.sql` |
| `20261021160000` | `20261021160000_add_system_health_events.sql` |
| `20261021163700` | `20261021163700_fix_wallet_token_supply_invariant.sql` |
| `20261021165000` | `20261021165000_harden_aviator_cashout_idempotency.sql` |
| `20261021171000` | `20261021171000_limit_aviator_bet_idempotency_key_length.sql` |
| `20261021173000` | `20261021173000_validate_aviator_bet_user_and_round.sql` |
| `20261021175000` | `20261021175000_harden_aviator_bet_function_search_path.sql` |
| `20261021180000` | `20261021180000_harden_aviator_cashout_settlement_search_path.sql` |
| `20261021190000` | `20261021190000_add_authoritative_game_bet_rpc.sql` |
| `20261021193000` | `20261021193000_add_atomic_user_creation_rpcs.sql` |
| `20261021200000` | `20261021200000_expose_backend_schemas_to_postgrest.sql` |
| `20261023100000` | `20261023100000_reduce_aviator_round_cooldown_to_4_seconds.sql` |
| `20261023110000` | `20261023110000_allow_concurrent_aviator_cashouts.sql` |
| `20261023120000` | `20261023120000_harden_concurrent_aviator_cashout_timing.sql` |
| `20261023130000` | `20261023130000_roulette_durable_lifecycle.sql` |
| `20261023140000` | `20261023140000_roulette_escrow_stake_settlement.sql` |
| `20261023150000` | `20261023150000_roulette_persist_spin_phase.sql` |
| `20261023160000` | `20261023160000_aviator_cashout_single_authenticated_rpc.sql` |
| `20261023160000` | `20261023160000_roulette_bet_validation.sql` |
| `20261023170000` | `20261023170000_roulette_hash_integer_overflow.sql` |
| `20261023190000` | `20261023190000_aviator_realtime_broadcast.sql` |
| `20261109090000` | `20261109090000_aviator_realtime_and_recovery_hardening.sql` |

## Duplicate version prefixes

- `20261021120000`: `protect_reserved_wallet_balances`, `wallet_transfer_api_boundary`
- `20261023160000`: `aviator_cashout_single_authenticated_rpc`, `roulette_bet_validation`

## Known safety notes

- `20261018000000_initial_schema.sql` is not applied under that version and creates legacy public tables. Treat it as bootstrap-only until a clean-project bootstrap test proves otherwise; do not apply it to the live shared project.
- `20261025053037_shared_aviator_wallet_operations.sql` was restored by PR #121 under the exact already-applied version. It is one of the exact matches in this snapshot.
- `20261109090000_aviator_realtime_and_recovery_hardening.sql` has the same name as the applied ledger entry `aviator_realtime_and_recovery_hardening`, but the live ledger version is `20261109163549`. This is a version mismatch and the file can be seen as pending by the CLI despite the SQL effect already being present. Resolve by approved version/source reconciliation before any push.
- Duplicate prefixes include `20261021120000` (wallet reserved-balance protection / wallet API boundary) and `20261023160000` (Aviator authenticated cashout / Roulette bet validation).
- Several applied migrations are likely represented by later renamed files; the same-name candidates above are only candidates. Validate SQL content and live object definitions before treating them as equivalent.

## Required next steps

1. Recover original SQL from Git history/PRs for every applied-only version where possible.
2. For same-name/different-version candidates, compare full SQL and live database effects; document exact equivalence or keep both distinct.
3. For the 34 file-only versions, classify as bootstrap-only, superseded, equivalent-to-an-applied-version, or genuinely pending. Never apply them in bulk.
4. Resolve duplicate version prefixes so migration ordering is deterministic.
5. Build two disposable PostgreSQL tests: a clean bootstrap replay and an upgrade replay using the current applied ledger. Both must use `ON_ERROR_STOP=1` and synthetic data.
6. Only after review, propose a controlled migration-history reconciliation plan. No production migration ledger edits or DDL are part of this documentation PR.

## Scope and safety

This is an audit artifact only. No SQL was executed against the shared project, and no production data, migration history, wallets, bets, rounds, or schedulers were changed.