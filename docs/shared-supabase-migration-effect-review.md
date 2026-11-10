# Migration SQL-effect review — pass 1

Snapshot: 2026-11-10  
Production project: `nzvpuoeibqrpcltrszvr`  
Purpose: record what can be established from current source SQL and read-only production catalog inspection. This is **not** an authorization to replay or repair migration history.

## Verified inventory

- Production migration ledger: **65** rows (re-read from the live project during this review).
- Active root migration files: **57**.
- Exact version + name matches: **21**.
- Applied-only ledger rows: **44**.
- Source-only files: **36** (27 same-name/different-version candidates and 9 without a same-name applied row).
- Duplicate active timestamp prefixes: **20261021120000**, **20261023160000**.
- Archived legacy migration files: **13**.

The top-level reconciliation document had stale 58/37 counts from the pre-PR #149 snapshot. This pass corrects those figures to 57/36 and updates the archive count to 13.

## Same-name / different-version candidates — not yet proven equivalent

All rows below have a source filename whose suffix matches an applied ledger name, but the SQL version differs. A matching suffix is not evidence that the SQL bodies are identical. These files must remain classified as **unverified candidates** until the original applied SQL is recovered from repository history or another trusted source and compared byte-for-byte / by normalized SQL effect.

- `20261020120000_authoritative_game_runtime.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261020150000_harden_aviator_bet_idempotency.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261020170000_restore_aviator_pool_reservations.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021100000_prepare_game_schema_isolation.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021110000_harden_wallet_transfer_idempotency.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021120000_protect_reserved_wallet_balances.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021120000_wallet_transfer_api_boundary.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021130000_move_platform_wallet_aviator_tables.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021140000_split_authoritative_games_by_schema.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021160000_add_system_health_events.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021163700_fix_wallet_token_supply_invariant.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021165000_harden_aviator_cashout_idempotency.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021171000_limit_aviator_bet_idempotency_key_length.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021173000_validate_aviator_bet_user_and_round.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021175000_harden_aviator_bet_function_search_path.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021180000_harden_aviator_cashout_settlement_search_path.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021193000_add_atomic_user_creation_rpcs.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261021200000_expose_backend_schemas_to_postgrest.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023100000_reduce_aviator_round_cooldown_to_4_seconds.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023110000_allow_concurrent_aviator_cashouts.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023120000_harden_concurrent_aviator_cashout_timing.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023140000_roulette_escrow_stake_settlement.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023150000_roulette_persist_spin_phase.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023160000_aviator_cashout_single_authenticated_rpc.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023170000_roulette_hash_integer_overflow.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261023190000_aviator_realtime_broadcast.sql` — unverified same-name candidate; do not replay or rename yet.
- `20261109090000_aviator_realtime_and_recovery_hardening.sql` — unverified same-name candidate; do not replay or rename yet.

## Nine source-only files without a same-name applied ledger row

| Source file | Pass-1 classification | Evidence / required next step |
|---|---|---|
| `20261018000000_initial_schema.sql` | Bootstrap-only candidate | Creates legacy public tables and enum types. Not an incremental production migration; validate only in a clean disposable bootstrap. |
| `20261019170000_fix_crash_pool_reservation_release.sql` | Unverified historical function revision | Replaces public Crash bet/cashout/settlement functions. Live Aviator equivalents exist in the `aviator` schema; recover original applied SQL and compare semantics before classifying. |
| `20261019171000_validate_wallet_idempotency_reuse.sql` | Unverified historical function revision | Replaces `public.wallet_transfer_atomic`. The live function exists; exact idempotency behavior and SQL provenance still need comparison. |
| `20261020140000_shared_game_pool.sql` | **Unsafe to replay** | Attempts `ALTER TABLE public.game_pools`, but live `public.game_pools` is a compatibility view. Current catalog has five platform games with five distinct pool-wallet IDs. Applied ledger has historical `use_one_shared_game_pool` at 20261020034914; do not apply this source file as a new migration. |
| `20261021190000_add_authoritative_game_bet_rpc.sql` | Unverified historical RPC revision | Defines `platform.place_authoritative_game_bets_atomic` and `platform.resolve_token_request_atomic`; both objects exist live. The applied row is `add_authoritative_game_bet_and_request_rpcs` at 20261021115840. Recover and compare the exact applied SQL. |
| `20261023130000_roulette_durable_lifecycle.sql` | Unverified historical lifecycle revision | Defines `roulette.advance_round()`; live object exists. Later Roulette migrations also replace this function, so compare the full applied chain rather than replaying this file. |
| `20261023160000_roulette_bet_validation.sql` | Unverified historical trigger revision; duplicate timestamp | Defines `roulette.validate_bet_selection()` and a trigger. Applied ledger has `roulette_database_bet_selection_validation` at 20261023112431. Compare trigger/function definitions and resolve the 20261023160000 prefix collision before any rename. |
| `20261110120000_aviator_realtime_event_sequence.sql` | **Genuinely pending candidate** | Live `aviator.game_rounds.multiplier_tick_seq` is absent and the live broadcast wrapper does not emit `tickSequence`. The isolated PostgreSQL 17 CI test added in PR #149 passes; production deployment is still a separate reviewed change. |
| `20261110130000_harden_rls_auto_enable_grants.sql` | Effect already present in production | Read-only grant inspection found browser-role EXECUTE already revoked on `public.rls_auto_enable()`. Keep source-controlled for reproducibility; no production DDL is needed for this effect. |

## Read-only production object fingerprint snapshot

The following live function objects and signatures were confirmed present. MD5 values are fingerprints of the current `pg_get_functiondef` output, not proof that any particular historical migration file is equivalent.

| Schema | Function | Identity arguments | Current definition MD5 |
|---|---|---|---|
| `aviator` | `cashout_crash_bet_atomic` | `p_user_id uuid, p_bet_id uuid, p_idempotency_key text` | `3f2177f6539019d45757202cddf9feca` |
| `aviator` | `cashout_crash_bet_authenticated_atomic` | `p_user_id uuid, p_claimed_role text, p_bet_id uuid, p_idempotency_key text` | `a9baee5d83c140a593631cac419954e6` |
| `aviator` | `place_crash_bet_atomic` | `p_user_id uuid, p_round_id uuid, p_amount bigint, p_idempotency_key text, p_auto_cashout numeric` | `d17ab2f48034a58de187eda55c6da517` |
| `aviator` | `tick_crash_engine` | none | `7108afdba4fb84454ee5190d9696e327` |
| `aviator` | `tick_crash_engine_with_broadcast` | none | `d0ba29a800dd079a44b1817cd7a4da64` |
| `platform` | `create_user_atomic` | `p_actor_id uuid, p_username text, p_email text, p_password_hash text, p_role user_role_enum, p_initial_tokens bigint` | `92d2acb34f5973d45bfb96f381a48c7a` |
| `platform` | `place_authoritative_game_bets_atomic` | `p_game_code text, p_user_id uuid, p_bets jsonb, p_idempotency_key text` | `84515956bf082fc6f0a5fbdb219ec035` |
| `platform` | `register_referral_atomic` | `p_username text, p_email text, p_password_hash text, p_referral_code text` | `110b9c97b6314f6411e0ff567908ec22` |
| `platform` | `resolve_token_request_atomic` | `p_request_id uuid, p_actor_id uuid, p_action text, p_note text` | `19860a7bb855003b7255eb3fd119ce62` |
| `public` | `wallet_transfer_atomic` | `p_idempotency_key text, p_type transaction_type_enum, p_amount bigint, p_source_wallet_id uuid, p_target_wallet_id uuid, p_metadata jsonb` | `05d0ed44b5e85a9579a4fcb3c5066a0e` |
| `roulette` | `advance_round` | none | `3893af7769fa55a6676fc104647df272` |

## Safety gate — still open

1. Recover original SQL for all 44 applied-only ledger entries wherever possible; GitHub code search did not locate the original timestamped filenames for the first six applied-only probes.
2. Compare all 27 same-name candidates against the recovered applied SQL and live definitions, including function bodies, policies, triggers, indexes, grants, and data transformations.
3. Resolve the two duplicate timestamp prefixes without changing execution order.
4. Add a deterministic disposable PostgreSQL 17 **clean bootstrap** test and a separate **current-ledger upgrade replay** test with synthetic fixtures. A name/count check alone is not a bootstrap test.
5. Review rollback/backup strategy before any migration-history reconciliation.
6. Only after those gates pass, prepare a separate production plan. Do not run blanket `supabase db push`, `migration repair`, or production DDL as part of this pass.

## Production impact

This pass performed read-only catalog queries only. No production DDL, migration-history updates, wallet/bet/round/settlement mutations, or scheduler changes were made.


## Additional live/source SQL comparisons (read-only, 2026-11-10)

The following checks compare the normalized PL/pgSQL function bodies in the source files with the live `pg_get_functiondef` output. Equality here confirms the function body currently deployed, but does not by itself prove that every statement in the migration file (ACLs, comments, triggers, transaction wrappers, or other functions) is identical to the historical applied migration.

- `20261021190000_add_authoritative_game_bet_rpc.sql`: the live bodies of `platform.place_authoritative_game_bets_atomic(text,uuid,jsonb,text)` and `platform.resolve_token_request_atomic(uuid,uuid,text,text)` both match the source bodies exactly after whitespace normalization. This is strong evidence that the key RPC bodies from the source candidate are present in production. The applied ledger row is still named/versioned `20261021115840_add_authoritative_game_bet_and_request_rpcs`; recover the original applied migration before changing filenames or history.
- `20261021193000_add_atomic_user_creation_rpcs.sql`: the live bodies of `platform.create_user_atomic(uuid,text,text,text,user_role_enum,bigint)` and `platform.register_referral_atomic(text,text,text,text)` both match the source bodies exactly after whitespace normalization. The applied ledger row is `20261021120305_add_atomic_user_creation_rpcs`. Do not replay this later-timestamp source copy.
- Live `aviator.place_crash_bet_atomic`, `aviator.cashout_crash_bet_atomic`, and `aviator.settle_crash_round_atomic` all use the hardened `pg_catalog, pg_temp` search path. The live bet function also rejects idempotency keys longer than 119 characters; the cashout function enforces its 96-character limit. These checks support the expected effects of the search-path and key-length hardening candidates, but exact historical SQL comparison remains open.
- `20261021120000_protect_reserved_wallet_balances.sql` does **not** have a body identical to the current live `wallet.wallet_transfer_atomic`; the current live body is longer. The adjacent `20261021120000_wallet_transfer_api_boundary.sql` wrapper body also does not match the current live implementation. Treat these as historical revisions superseded by later wallet changes, not as proof that either source file can be replayed.


## Additional production effect verification (pass 2, read-only)

The following source-only candidates have their intended effect visible in the current production catalog. This is **effect evidence**, not proof that the exact original applied SQL was recovered. These files must not be replayed as new migrations.

| Source candidate | Production evidence | Classification |
|---|---|---|
| `20261021165000_harden_aviator_cashout_idempotency.sql` | Live `aviator.cashout_crash_bet_atomic` contains `INVALID_CASHOUT_IDEMPOTENCY_KEY` and enforces the 96-character caller-key limit. | Effect present; original applied SQL not recovered. |
| `20261021171000_limit_aviator_bet_idempotency_key_length.sql` | Live `aviator.place_crash_bet_atomic` enforces the 119-character caller-key limit. | Effect present; original applied SQL not recovered. |
| `20261021173000_validate_aviator_bet_user_and_round.sql` | Live `aviator.place_crash_bet_atomic` contains the `USER_AND_ROUND_REQUIRED` guard. | Effect present; original applied SQL not recovered. |
| `20261021175000_harden_aviator_bet_function_search_path.sql` | Live Aviator bet function has `search_path=pg_catalog, pg_temp`. | Effect present; original applied SQL not recovered. |
| `20261021180000_harden_aviator_cashout_settlement_search_path.sql` | Live cashout and round-settlement functions both have `search_path=pg_catalog, pg_temp`. | Effect present; original applied SQL not recovered. |
| `20261021160000_add_system_health_events.sql` | Live `platform.system_health_events` exists and has RLS enabled. | Table/RLS effect present; full columns, policies, indexes, and grants still need comparison. |

Two additional source candidates have stronger function-level evidence:

- `20261021190000_add_authoritative_game_bet_rpc.sql` (one of the 9 no-same-name candidates): both `platform.place_authoritative_game_bets_atomic` and `platform.resolve_token_request_atomic` bodies match the current production definitions after whitespace normalization. Both functions have ACLs that deny `anon` and `authenticated` while allowing `service_role`. This is strong deployed-effect evidence for the two RPCs and their execution boundary, but the original applied SQL at ledger version `20261021115840_add_authoritative_game_bet_and_request_rpcs` has not been recovered.
- `20261021193000_add_atomic_user_creation_rpcs.sql` (one of the 27 same-name candidates): both `platform.create_user_atomic` and `platform.register_referral_atomic` bodies match production after whitespace normalization. Their live ACLs also deny `anon` and `authenticated` and allow `service_role`. The applied ledger row is `20261021120305_add_atomic_user_creation_rpcs`. Preserve the current source as evidence; do not replay it.

The wallet source candidate `20261021120000_protect_reserved_wallet_balances.sql` remains a superseded historical revision: its function body does not match the current live `wallet.wallet_transfer_atomic` body. The live body is longer and must not be overwritten by replaying this file.

## Updated completion status

- Source inventory and count assertions are now covered by a stronger automated test in PR #151.
- All PostgreSQL-backed CI fixtures now run on PostgreSQL 17, matching production. PR #151 merged as `70f9ab36f2141b7613490b9f1fe82aece882a7d7`; all 7 CI jobs passed, including build/tests, schema migration, schema cutover, Edge Functions, Aviator lease, recovery/Realtime, and tick-sequence tests.
- Exact applied SQL recovery is still incomplete for many of the 44 applied-only ledger rows. GitHub commit search found some historical implementation commits, but did not recover the exact original migration files for the full applied ledger.
- The current root migration directory is **not yet a safe clean-bootstrap sequence**. It contains source-only historical copies, one known incompatible shared-pool migration, duplicate timestamp prefixes, and a pending Realtime sequence migration.
- No current-ledger upgrade replay can be declared safe until the historical SQL mapping is complete and the replay has been executed against a disposable copy with synthetic data.

No production DDL, migration repair, or financial data changes were performed during this pass.
