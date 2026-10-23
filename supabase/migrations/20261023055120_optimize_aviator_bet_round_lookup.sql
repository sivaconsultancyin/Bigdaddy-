-- Resolve the current waiting round inside Postgres so the bet endpoint avoids
-- one separate PostgREST request. The existing atomic function still performs
-- all round locking, wallet validation, transfer, idempotency, and bet creation.
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
   WHERE gr.status = 'WAITING'
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
