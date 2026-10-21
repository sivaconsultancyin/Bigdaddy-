-- Harden cashout RPC input validation. The prefix "BET_PAYOUT_" adds 11
-- characters, so cap caller idempotency keys at 96 chars to stay below the
-- wallet transaction key limit of 128. Restrict to stable URL-safe characters.
DO $migration$
DECLARE
  v_definition text;
  v_old text := 'BEGIN
  SELECT round_id INTO v_round_id FROM aviator.game_bets WHERE id = p_bet_id AND user_id = p_user_id;';
  v_new text := 'BEGIN
  IF p_user_id IS NULL OR p_bet_id IS NULL THEN
    RAISE EXCEPTION ''USER_AND_BET_REQUIRED'' USING ERRCODE = ''22023'';
  END IF;
  IF p_idempotency_key IS NULL
     OR length(trim(p_idempotency_key)) < 8
     OR length(p_idempotency_key) > 96
     OR p_idempotency_key !~ ''^[A-Za-z0-9_-]+$'' THEN
    RAISE EXCEPTION ''INVALID_CASHOUT_IDEMPOTENCY_KEY'' USING ERRCODE = ''22023'';
  END IF;
  SELECT round_id INTO v_round_id FROM aviator.game_bets WHERE id = p_bet_id AND user_id = p_user_id;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'aviator'
    AND p.proname = 'cashout_crash_bet_atomic'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_user_id uuid, p_bet_id uuid, p_idempotency_key text';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'cashout function not found';
  END IF;

  IF position(v_new IN v_definition) > 0 THEN
    RAISE NOTICE 'Cashout idempotency validation already installed';
    RETURN;
  END IF;

  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected cashout function body not found; refusing to patch';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;
