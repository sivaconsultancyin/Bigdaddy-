-- One PostgREST call for Aviator bet authorization, atomic placement, and response readback.
-- The Edge Function verifies the signed token cryptographically; this RPC then re-checks
-- the current database user and role so disabled users/stale role claims cannot place bets.
CREATE OR REPLACE FUNCTION aviator.place_crash_bet_authenticated_atomic(
  p_user_id uuid,
  p_claimed_role text,
  p_amount bigint,
  p_idempotency_key text,
  p_auto_cashout numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
DECLARE
  v_is_active boolean;
  v_role_count integer;
  v_db_role text;
  v_bet_id uuid;
  v_bet record;
BEGIN
  SELECT u.is_active, count(ra.role)::integer, min(ra.role::text)
    INTO v_is_active, v_role_count, v_db_role
    FROM platform.users AS u
    LEFT JOIN platform.role_assignments AS ra ON ra.user_id = u.id
   WHERE u.id = p_user_id
   GROUP BY u.id, u.is_active;

  IF NOT FOUND OR v_is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'USER_NOT_FOUND_OR_DISABLED';
  END IF;
  IF v_role_count <> 1 OR v_db_role IS NULL THEN
    RAISE EXCEPTION 'AUTH_SERVICE_UNAVAILABLE';
  END IF;
  IF v_db_role <> p_claimed_role THEN
    RAISE EXCEPTION 'TOKEN_ROLE_STALE';
  END IF;
  IF v_db_role <> 'PLAYER' THEN
    RAISE EXCEPTION 'PLAYER_ONLY';
  END IF;

  -- This existing atomic function remains the authority for round locks, wallet
  -- balance/transfer, idempotency, and bet creation.
  v_bet_id := aviator.place_crash_bet_current_round_atomic(
    p_user_id, p_amount, p_idempotency_key, p_auto_cashout
  );
  IF v_bet_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_OPEN_ROUND');
  END IF;

  SELECT b.id, b.round_id, b.bet_amount, b.auto_cashout, b.status
    INTO v_bet
    FROM aviator.game_bets AS b
   WHERE b.id = v_bet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BET_CREATED_BUT_READBACK_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'bet', jsonb_build_object(
      'id', v_bet.id,
      'roundId', v_bet.round_id,
      'betAmount', v_bet.bet_amount::text,
      'autoCashout', v_bet.auto_cashout,
      'status', v_bet.status
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION aviator.place_crash_bet_authenticated_atomic(uuid, text, bigint, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION aviator.place_crash_bet_authenticated_atomic(uuid, text, bigint, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.place_crash_bet_authenticated_atomic(uuid, text, bigint, text, numeric) TO service_role, postgres;
