-- SECURITY DEFINER hardening for Aviator cashout and round settlement.
-- Both functions schema-qualify application tables/functions, so public must not
-- be on the search_path. Preserve the current function bodies and signatures.
DO $migration$
DECLARE
  v_signature regprocedure;
  v_def text;
  v_old text := $old$SET search_path TO 'public', 'pg_temp'$old$;
  v_new text := $new$SET search_path TO 'pg_catalog', 'pg_temp'$new$;
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'aviator.cashout_crash_bet_atomic(uuid,uuid,text)',
    'aviator.settle_crash_round_atomic(uuid)'
  ]
  LOOP
    v_signature := v_name::regprocedure;
    v_def := pg_get_functiondef(v_signature);

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'AVIATOR_FUNCTION_NOT_FOUND: %', v_name;
    END IF;

    IF position('SET search_path TO ''pg_catalog'', ''pg_temp''' IN v_def) > 0 THEN
      RAISE NOTICE 'Aviator function search_path already hardened: %', v_name;
      CONTINUE;
    END IF;

    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'EXPECTED_SEARCH_PATH_NOT_FOUND for %', v_name;
    END IF;

    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
  END LOOP;
END
$migration$;
