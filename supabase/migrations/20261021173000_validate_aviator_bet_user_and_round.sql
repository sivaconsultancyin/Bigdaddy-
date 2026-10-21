-- Reject missing caller/user and round identifiers before any bet processing.
-- This keeps malformed calls from reaching wallet lookups or round locks.
DO $migration$
DECLARE
  v_def text;
  v_old text := $old$BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;$old$;
  v_new text := $new$BEGIN
  IF p_user_id IS NULL OR p_round_id IS NULL THEN
    RAISE EXCEPTION 'USER_AND_ROUND_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('aviator.place_crash_bet_atomic(uuid,uuid,bigint,text,numeric)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PLACE_BET_VALIDATION_NOT_FOUND';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
