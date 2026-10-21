-- BigDaddy schema dependency inventory: READ-ONLY, run before any SET SCHEMA / function move.
-- Usage: psql -X -v ON_ERROR_STOP=1 -f scripts/db/schema-dependency-inventory.sql
-- Run on a recent staging clone first. This script emits catalog evidence only; no DDL/DML.
\echo '1) Target objects currently in public and proposed destination'
SELECT t.tablename,
       CASE
         WHEN t.tablename IN ('users','user_profiles','role_assignments','referral_codes','audit_logs') THEN 'platform'
         WHEN t.tablename IN ('wallets','wallet_transactions','ledger_entries','token_supply','game_pools') THEN 'wallet'
         WHEN t.tablename IN ('game_rounds','game_bets') THEN 'aviator'
         WHEN t.tablename IN ('authoritative_game_rounds','authoritative_game_bets') THEN 'per-game schema selected by game_code; split migration required'
         WHEN t.tablename = 'games' THEN 'platform'
         ELSE 'review manually'
       END AS proposed_destination
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
ORDER BY t.tablename;

\echo '2) Columns and user-defined types for target tables'
SELECT c.relname AS table_name, a.attnum AS ordinal_position, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS column_type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expression,
       CASE WHEN ty.typtype = 'e' THEN format('%I.%I', ns.nspname, ty.typname) END AS enum_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_type ty ON ty.oid = a.atttypid
JOIN pg_namespace ns ON ns.oid = ty.typnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND c.relname IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
ORDER BY c.relname, a.attnum;

\echo '3) Constraints and foreign-key dependencies touching target tables'
SELECT con.conname, con.contype, con.convalidated,
       con.conrelid::regclass AS source_table,
       NULLIF(con.confrelid, 0)::regclass AS referenced_table,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
WHERE con.conrelid IN (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
)
OR con.confrelid IN (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
)
ORDER BY source_table::text, con.conname;

\echo '4) Triggers on target tables'
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled,
       pg_get_triggerdef(t.oid, true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname='public'
  AND c.relname IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
ORDER BY c.relname, t.tgname;

\echo '5) RLS flags and policies'
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       p.polname AS policy_name, p.polcmd, p.polpermissive,
       pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression,
       ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)) AS policy_roles
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid=c.oid
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND c.relname IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
ORDER BY c.relname, p.polname;

\echo '6) Table, sequence and schema privileges'
SELECT 'table' AS object_kind, format('%I.%I', n.nspname, c.relname) AS object_name,
       grantee.rolname AS grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants g
JOIN pg_class c ON c.relname=g.table_name
JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname=g.table_schema
JOIN pg_roles grantee ON grantee.rolname=g.grantee
WHERE g.table_schema='public' AND g.table_name IN (
  'users','user_profiles','role_assignments','referral_codes','audit_logs',
  'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
  'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
)
ORDER BY object_name, grantee, privilege_type;

SELECT 'schema' AS object_kind, n.nspname AS object_name, r.rolname AS grantee,
       has_schema_privilege(r.oid, n.oid, 'USAGE') AS has_usage,
       has_schema_privilege(r.oid, n.oid, 'CREATE') AS has_create
FROM pg_namespace n CROSS JOIN pg_roles r
WHERE n.nspname IN ('public','platform','wallet','aviator','roulette','dice','dragon_tiger','andar_bahar','teen_patti')
  AND r.rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY object_name, grantee;

\echo '7) Functions/procedures defined in public that reference target tables or financial/game operations'
SELECT n.nspname AS schema_name, p.oid::regprocedure AS signature,
       p.prosecdef AS security_definer, p.proconfig AS function_settings,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND (p.prokind IN ('f','p'))
  AND (
    p.proname ILIKE '%wallet%' OR p.proname ILIKE '%bet%' OR
    p.proname ILIKE '%cashout%' OR p.proname ILIKE '%round%' OR
    p.proname ILIKE '%settle%' OR p.proname ILIKE '%pool%' OR
    pg_get_functiondef(p.oid) ILIKE '%public.wallets%' OR
    pg_get_functiondef(p.oid) ILIKE '%public.game_rounds%' OR
    pg_get_functiondef(p.oid) ILIKE '%public.authoritative_game_bets%'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

\echo '8) Views/materialized views depending on target tables'
SELECT DISTINCT view_ns.nspname AS view_schema, view_c.relname AS view_name,
       view_c.relkind AS view_kind, pg_get_viewdef(view_c.oid, true) AS definition
FROM pg_rewrite rw
JOIN pg_class view_c ON view_c.oid=rw.ev_class
JOIN pg_namespace view_ns ON view_ns.oid=view_c.relnamespace
JOIN pg_depend dep ON dep.classid='pg_rewrite'::regclass AND dep.objid=rw.oid
JOIN pg_class target_c ON target_c.oid=dep.refobjid
JOIN pg_namespace target_ns ON target_ns.oid=target_c.relnamespace
WHERE view_c.relkind IN ('v','m') AND target_ns.nspname='public'
  AND target_c.relname IN (
    'users','user_profiles','role_assignments','referral_codes','audit_logs',
    'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
    'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
ORDER BY view_schema, view_name;

\echo '9) Type dependencies: enums/domains used by target table columns'
SELECT DISTINCT tn.nspname AS type_schema, t.typname AS type_name,
       t.typtype AS type_kind, format_type(t.oid, NULL) AS formatted_type
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
JOIN pg_type t ON t.oid=a.atttypid
JOIN pg_namespace tn ON tn.oid=t.typnamespace
WHERE n.nspname='public' AND c.relname IN (
  'users','user_profiles','role_assignments','referral_codes','audit_logs',
  'wallets','wallet_transactions','ledger_entries','token_supply','game_pools',
  'games','game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
)
AND t.typtype IN ('e','d')
ORDER BY type_schema, type_name;

\echo '10) Completion gate: do not move objects until this inventory is reviewed on staging'
SELECT 'Review every output section; preserve dependencies, RLS, grants, and balances before migration.' AS required_action;
