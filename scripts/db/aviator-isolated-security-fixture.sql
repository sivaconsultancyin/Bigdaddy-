-- Disposable PostgreSQL fixture for the isolated Aviator hardening migration.
-- CI only: never execute this fixture against a Supabase project.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA aviator;
CREATE TABLE aviator.game_rounds (id uuid PRIMARY KEY);
CREATE TABLE aviator.game_bets (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES aviator.game_rounds(id)
);
CREATE TABLE aviator.game_settlements (
  id uuid PRIMARY KEY,
  bet_id uuid NOT NULL REFERENCES aviator.game_bets(id),
  round_id uuid NOT NULL REFERENCES aviator.game_rounds(id)
);

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name = 'public'
       AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl
        FROM pg_catalog.pg_class c
        WHERE c.oid = cmd.objid;
        EXECUTE format('ALTER TABLE IF EXISTS %I.%I ENABLE ROW LEVEL SECURITY', cmd.schema_name, tbl);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated, service_role;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  EXECUTE FUNCTION public.rls_auto_enable();
