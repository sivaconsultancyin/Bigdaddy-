# Supabase HTTPS Data API migration

## Backend-only environment

Configure these on the backend service (never in Vite variables or the APK):

- `SUPABASE_URL`: the project URL, e.g. `https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: service-role secret from the Supabase project

Do not commit real values. Do not send keys or database passwords in chat or logs.

## Current status

`supabase-api.ts` adds a server-only HTTPS/PostgREST/RPC request helper. It does **not** automatically translate existing SQL queries and does not yet replace `postgres.ts`. Existing routes and the game worker still need a route-by-route migration and integration tests.

## Before using a custom schema

The schema must be enabled in Supabase Dashboard API settings for the Data API, and table/function privileges plus RLS must be reviewed. Enable only required schemas. A service-role key bypasses RLS and must remain on the trusted backend.

## Transaction safety

Use PostgreSQL RPC functions for operations that must be atomic, such as wallet debits, bet placement, cashout and settlement. Do not split a balance update and ledger insert into separate HTTP requests.

## Safe rollout

Keep the existing PostgreSQL connection code until all routes and workers have migrated and passed tests. Never switch production traffic based only on a successful API health check.