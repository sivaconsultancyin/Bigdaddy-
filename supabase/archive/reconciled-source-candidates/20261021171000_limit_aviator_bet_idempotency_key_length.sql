-- Prevent BET_LOCK_ + caller key from exceeding wallet.wallet_transactions'
-- 128-character idempotency-key limit. "BET_LOCK_" adds 9 characters.
DO $migration$
DECLARE
  v_def text;
  v_old text := $old$IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;$old$;
  v_new text := $new$IF p_idempotency_key IS NULL
     OR length(trim(p_idempotency_key)) < 8
     OR length(p_idempotency_key) > 119 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('aviator.place_crash_bet_atomic(uuid,uuid,bigint,text,numeric)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PLACE_BET_FUNCTION_NOT_FOUND';
  END IF;

  -- Safe on databases where the hardening has already been applied.
  IF position('length(p_idempotency_key) > 119' IN v_def) > 0 THEN
    RAISE NOTICE 'Aviator bet idempotency length limit already installed';
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PLACE_BET_VALIDATION_NOT_FOUND';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
