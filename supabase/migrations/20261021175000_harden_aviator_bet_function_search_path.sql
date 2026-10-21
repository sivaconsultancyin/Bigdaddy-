-- SECURITY DEFINER hardening: every application table/function referenced in
-- place_crash_bet_atomic is schema-qualified, so public need not be in search_path.
DO $migration$
DECLARE
  v_def text;
  v_old text := $old$SET search_path TO 'public', 'pg_temp'$old$;
  v_new text := $new$SET search_path TO 'pg_catalog', 'pg_temp'$new$;
BEGIN
  SELECT pg_get_functiondef('aviator.place_crash_bet_atomic(uuid,uuid,bigint,text,numeric)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PLACE_BET_SEARCH_PATH_NOT_FOUND';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
