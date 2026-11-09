DO $verify$
DECLARE
  before_count bigint;
BEGIN
  IF has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute rls_auto_enable';
  END IF;
  IF has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute rls_auto_enable';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role grant was unexpectedly removed';
  END IF;
  IF to_regclass('aviator.game_bets_round_id_idx') IS NULL
     OR to_regclass('aviator.game_settlements_round_id_idx') IS NULL THEN
    RAISE EXCEPTION 'Aviator round foreign-key indexes are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger
    WHERE evtname='ensure_rls' AND evtenabled='O'
  ) THEN
    RAISE EXCEPTION 'ensure_rls event trigger is not enabled';
  END IF;

  SELECT count(*) INTO before_count FROM public.rls_trigger_invocations;
  EXECUTE 'CREATE TABLE aviator.after_migration_probe(id integer)';
  IF (SELECT count(*) FROM public.rls_trigger_invocations) <= before_count THEN
    RAISE EXCEPTION 'ensure_rls event trigger did not execute after grants were revoked';
  END IF;
  EXECUTE 'DROP TABLE aviator.after_migration_probe';
END
$verify$;
