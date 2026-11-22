-- Combine the account/role validation and Aviator cashout in one Postgres RPC.
-- JWT cryptographic validation remains in the Edge Function. Financial settlement
-- stays in cashout_crash_bet_atomic, preserving its locks, idempotency and ledger.
CREATE OR REPLACE FUNCTION aviator.cashout_crash_bet_authenticated_atomic(
  p_user_id uuid,
  p_claimed_role text,
  p_bet_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_is_active boolean;
  v_role_count integer;
  v_db_role text;
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

  RETURN aviator.cashout_crash_bet_atomic(
    p_user_id, p_bet_id, p_idempotency_key
  );
END;
$function$;

REVOKE ALL ON FUNCTION aviator.cashout_crash_bet_authenticated_atomic(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.cashout_crash_bet_authenticated_atomic(uuid, text, uuid, text) TO service_role;
