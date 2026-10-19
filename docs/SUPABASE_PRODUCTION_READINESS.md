# Supabase production readiness and migration runbook

Project: BigDaddy (project ref nzvpuoeibqrpcltrszvr). Treat all financial tables as production-critical.

## Current audit snapshot (2026-10-20)

- Live project is healthy on PostgreSQL 17.
- Public schema: 16 tables, 125 columns, 25 foreign keys, 65 indexes.
- All 16 public tables have RLS enabled; 16 restrictive deny policies exist for anon and authenticated.
- Catalog snapshot: zero invalid indexes and zero unvalidated constraints.
- Token supply check passed: wallet balances sum to 10,000,000,000; max_supply and total_minted are 10,000,000,000.
- Aviator reservation was reconciled: pool reserved_balance=0, pending bets=0, calculated pending liability=0. Wallet balance was not changed.
- A stale Aviator round (round_number 154, status WAITING, no bets) remains. Do not rewrite it automatically until game lifecycle/recovery policy is tested.
- No Supabase development branches are listed. The available Supabase connector does not expose a database backup/export/restore operation, so a backup has NOT been created or restore-tested by this workflow.

## Canonical schema and baseline

The initial schema lived in database/migrations/002_supabase_schema.sql outside the Supabase CLI migration directory. That made fresh-project setup from supabase/migrations alone incomplete.

supabase/migrations/20261018000000_initial_schema.sql is now the canonical baseline for a NEW, EMPTY project only. It creates the base enums, tables, indexes, and RLS enablement. Apply subsequent supabase/migrations in timestamp order to add production functions, constraints, seed data, and later fixes. The genesis/seed migration is production data initialization and must only run against a new, empty database.

### Existing production project baseline repair

Never run the baseline SQL against live: it creates types and tables. After verifying that the live schema derives from this baseline plus the already-applied migrations, link the Supabase CLI to the project and mark the baseline version as already applied:

```bash
supabase link --project-ref nzvpuoeibqrpcltrszvr
supabase migration list
supabase migration repair --status applied 20261018000000
supabase migration list
```

Do this only after backup and schema-diff review. It changes migration history, not application tables. It does not apply the two missing incremental migrations.

## Migration drift that still requires controlled repair

The live migration history has 12 earlier entries, plus a reservation reconciliation entry named reconcile_aviator_pool_reservations at live version 20261019185311. The repository migration is renamed to match that live version so repository and remote history can align.

The following repository migrations were absent from live history at audit time:
- 20261019170000_fix_crash_pool_reservation_release.sql
- 20261019171000_validate_wallet_idempotency_reuse.sql

After a restorable backup, schema comparison, and staging test, apply these two migrations in timestamp order with the Supabase CLI. Do not run their SQL manually through SQL Editor because that bypasses migration history.

## Backup and rollback gate — required before production DDL

1. In Supabase Dashboard, open Database → Backups and confirm latest backup timestamp, retention, and whether point-in-time recovery is enabled for the current plan.
2. Create/confirm a fresh restorable backup immediately before the maintenance window. If the plan does not support an on-demand backup, take a logical dump with a trusted PostgreSQL client and secure storage; include schema and data, record the exact command/tool version, and store it securely. Never commit dump files or credentials to Git.
3. Restore the backup into a separate staging project and verify the restore works. A backup that has not been restore-tested is not a complete rollback plan.
4. Capture pre-migration evidence: supabase migration list, scripts/production_schema_audit.sql, scripts/production_financial_reconciliation.sql, and app test/build output.
5. Apply one migration at a time in timestamp order; verify history and re-run audits after each migration. Stop immediately on unexpected results.
6. Failed transactional DDL rolls back with its transaction. For a committed migration, prefer a reviewed forward-fix. Do not blindly reverse financial function changes or delete ledger data.
7. If data corruption or unrecoverable schema failure occurs, pause writes / put the app in maintenance mode and use the tested point-in-time/logical restore plan. A restore can discard transactions written after the restore point; reconcile that explicitly.

## Local / new-project workflow

1. Install the Supabase CLI and authenticate.
2. Create an empty Supabase project and link it.
3. Confirm no application migrations exist in the new project.
4. Run supabase db push to apply the canonical baseline and all incremental migrations in timestamp order.
5. Verify migration history, run schema and financial audit SQL, then run application lint, tests, and build.
6. Run bootstrap seeding only once on an empty database; never rerun it against a populated production database.

## Production release gates

- No migration-history drift remains.
- Fresh-project bootstrap succeeds from repository migrations alone.
- Schema diff matches expected columns, defaults, enum values, foreign keys, checks, indexes, functions, and RLS policies.
- Financial invariant and settlement tests pass against real PostgreSQL, not only an in-memory store.
- Stale WAITING/RUNNING/CRASHED round recovery is covered by tests and an operational policy.
- Backup restore is tested, deployment health checks pass, and rollback/forward-fix ownership is assigned.

This document does not declare the application production-ready until every gate above is verified.
