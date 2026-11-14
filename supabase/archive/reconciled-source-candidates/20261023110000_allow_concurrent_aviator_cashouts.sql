-- Allow independent cashouts in the same Aviator round to validate concurrently.
-- The round must remain protected from a crash transition while a cashout settles,
-- but FOR UPDATE unnecessarily serialized every player's cashout on the round row.
-- FOR SHARE still blocks a crash UPDATE and is compatible with other cashouts' locks.
DO $migration$
DECLARE
  v_signature regprocedure := 'aviator.cashout_crash_bet_atomic(uuid,uuid,text)'::regprocedure;
  v_def text;
  v_old text := 'FROM aviator.game_rounds WHERE id = v_round_id FOR UPDATE;';
  v_new text := 'FROM aviator.game_rounds WHERE id = v_round_id FOR SHARE;';
BEGIN
  v_def := pg_get_functiondef(v_signature);

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'AVIATOR_CASHOUT_FUNCTION_NOT_FOUND';
  END IF;

  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'Aviator cashout round lock already allows concurrent readers';
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_AVIATOR_CASHOUT_ROUND_LOCK_NOT_FOUND';
  END IF;

  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'EXPECTED_EXACTLY_ONE_AVIATOR_CASHOUT_ROUND_LOCK';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
