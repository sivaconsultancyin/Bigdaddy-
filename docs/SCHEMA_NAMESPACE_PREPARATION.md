# Schema Namespace Preparation

Migration: `supabase/migrations/20261021100000_prepare_game_schema_isolation.sql`

## What this migration does

- Creates private namespaces for `platform`, `wallet`, and the six game schemas.
- Revokes schema access from `PUBLIC`, `anon`, and `authenticated`.
- Grants schema `USAGE` to the server-side Supabase `service_role`; this does not grant table or function privileges.
- Leaves every existing `public.*` table, function, API, and worker query unchanged.

## What this migration does not do

- It does not move tables or functions.
- It does not change wallet balances, pool balances, reservations, bets, or ledger entries.
- It does not expose these schemas through PostgREST.
- It does not complete the central-wallet cutover.

## Preconditions for applying

1. Confirm the live Supabase project and deployed migration version.
2. Take and verify a restorable database backup.
3. Apply to staging first using the same Supabase migration mechanism used by production.
4. Verify the schemas exist and that `anon` / `authenticated` cannot use them.
5. Confirm existing login, wallet, bet, cashout, round settlement, and worker flows still pass.

## Required follow-up migrations

1. Move shared identity/config objects into `platform` with compatibility and FK handling.
2. Move wallet/ledger objects into `wallet` behind hardened, idempotent database functions.
3. Migrate Aviator tables/functions and its worker as one bounded cutover.
4. Migrate Roulette, Dice, Dragon Tiger, Andar Bahar, and Teen Patti independently.
5. Reconcile balances, ledger entries, reserved liabilities, and open bets before and after each cutover.

Do not move financial tables with a blanket `ALTER TABLE ... SET SCHEMA` operation. Existing PL/pgSQL bodies contain explicit `public.*` references and must be updated and tested as part of each subsystem cutover.
