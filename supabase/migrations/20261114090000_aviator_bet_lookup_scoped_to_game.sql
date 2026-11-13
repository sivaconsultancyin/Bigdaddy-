-- Scope Aviator's current-round lookup to Aviator only. Without the game_code
-- predicate, a WAITING round belonging to another crash game could be selected
-- and then rejected by place_crash_bet_atomic after the user submits a wager.
CREATE OR REPLACE FUNCTION aviator.place_crash_bet_current_round_atomic(
  p_user_id uuid,
  p_amount bigint,
  p_idempotency_key text,
  p_auto_cashout numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
DECLARE
  v_round_id uuid;
BEGIN
  SELECT gr.id
    INTO v_round_id
    FROM aviator.game_rounds AS gr
   WHERE gr.game_code = 'aviator'
     AND gr.status = 'WAITING'
   ORDER BY gr.round_number DESC
   LIMIT 1;

  IF v_round_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN aviator.place_crash_bet_atomic(
    p_user_id,
    v_round_id,
    p_amount,
    p_idempotency_key,
    p_auto_cashout
  );
END;
$function$;

REVOKE ALL ON FUNCTION aviator.place_crash_bet_current_round_atomic(uuid, bigint, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION aviator.place_crash_bet_current_round_atomic(uuid, bigint, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.place_crash_bet_current_round_atomic(uuid, bigint, text, numeric) TO service_role, postgres;
