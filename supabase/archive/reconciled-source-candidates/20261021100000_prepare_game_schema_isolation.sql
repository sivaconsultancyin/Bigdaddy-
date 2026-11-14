-- Prepare isolated namespaces for the shared-wallet / per-game-schema rollout.
-- This is intentionally additive: existing public tables, functions, APIs, and data
-- remain authoritative until later migrations move one bounded subsystem at a time.
BEGIN;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS wallet;
CREATE SCHEMA IF NOT EXISTS aviator;
CREATE SCHEMA IF NOT EXISTS roulette;
CREATE SCHEMA IF NOT EXISTS dice;
CREATE SCHEMA IF NOT EXISTS dragon_tiger;
CREATE SCHEMA IF NOT EXISTS andar_bahar;
CREATE SCHEMA IF NOT EXISTS teen_patti;

COMMENT ON SCHEMA platform IS
  'Shared identity and platform configuration namespace; public compatibility objects remain authoritative during migration.';
COMMENT ON SCHEMA wallet IS
  'Central player-wallet and double-entry ledger namespace; game schemas must not receive direct balance/ledger write privileges.';
COMMENT ON SCHEMA aviator IS
  'Aviator game-owned tables and runtime objects; populate only after compatibility functions and worker callers are migrated.';
COMMENT ON SCHEMA roulette IS
  'Roulette game-owned tables and runtime objects; central player wallet remains in wallet schema.';
COMMENT ON SCHEMA dice IS
  'Dice game-owned tables and runtime objects; central player wallet remains in wallet schema.';
COMMENT ON SCHEMA dragon_tiger IS
  'Dragon Tiger game-owned tables and runtime objects; central player wallet remains in wallet schema.';
COMMENT ON SCHEMA andar_bahar IS
  'Andar Bahar game-owned tables and runtime objects; central player wallet remains in wallet schema.';
COMMENT ON SCHEMA teen_patti IS
  'Teen Patti game-owned tables and runtime objects; central player wallet remains in wallet schema.';

-- Never make these namespaces available to anonymous/authenticated PostgREST roles.
-- Usage for service_role alone does not grant table/function privileges.
REVOKE ALL ON SCHEMA platform, wallet, aviator, roulette, dice,
  dragon_tiger, andar_bahar, teen_patti FROM PUBLIC;

REVOKE ALL ON SCHEMA platform, wallet, aviator, roulette, dice,
  dragon_tiger, andar_bahar, teen_patti FROM anon, authenticated;

GRANT USAGE ON SCHEMA platform, wallet, aviator, roulette, dice,
  dragon_tiger, andar_bahar, teen_patti TO service_role;

COMMIT;
