-- Run after applying 20261025240000_aviator_security_and_fk_indexes.sql.
DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Browser roles must not execute the SECURITY DEFINER event-trigger function';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Explicit service_role function grant was not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='aviator' AND tablename='game_bets'
      AND indexname='game_bets_round_id_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='aviator' AND tablename='game_settlements'
      AND indexname='game_settlements_round_id_idx'
  ) THEN
    RAISE EXCEPTION 'Aviator round_id foreign-key indexes are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger
    WHERE evtname='ensure_rls' AND evtenabled='O'
      AND evtfoid='public.rls_auto_enable()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'The public-table RLS event trigger was disabled or replaced';
  END IF;
END
$verify$;

-- Prove the event trigger continues to work after EXECUTE is revoked from browser roles.
CREATE TABLE public.event_trigger_probe (id integer PRIMARY KEY);
DO $verify$
BEGIN
  IF NOT (
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='event_trigger_probe'
  ) THEN
    RAISE EXCEPTION 'RLS event trigger did not enable RLS after function ACL hardening';
  END IF;
END
$verify$;
DROP TABLE public.event_trigger_probe;
