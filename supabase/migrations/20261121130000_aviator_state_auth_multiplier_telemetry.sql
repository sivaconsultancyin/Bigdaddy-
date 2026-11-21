-- Reduce authenticated Aviator state requests to one authorization round-trip.
-- Preserve current-account and current-role checks inside a restricted SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION platform.resolve_big_daddy_actor(
  p_user_id uuid,
  p_claimed_role text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'parent_id', u.parent_id,
    'role', ra.role::text
  )
  INTO v_actor
  FROM platform.users AS u
  LEFT JOIN platform.role_assignments AS ra ON ra.user_id = u.id
  WHERE u.id = p_user_id
    AND u.is_active = true;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'USER_NOT_FOUND_OR_DISABLED');
  END IF;

  IF v_actor->>'role' IS NULL THEN
    RETURN jsonb_build_object('error', 'ROLE_ASSIGNMENT_INVALID');
  END IF;

  IF v_actor->>'role' IS DISTINCT FROM p_claimed_role THEN
    RETURN jsonb_build_object('error', 'TOKEN_ROLE_STALE');
  END IF;

  RETURN v_actor;
END;
$function$;

REVOKE ALL ON FUNCTION platform.resolve_big_daddy_actor(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.resolve_big_daddy_actor(uuid, text) TO service_role;

COMMENT ON FUNCTION platform.resolve_big_daddy_actor(uuid, text) IS
  'Validates active BigDaddy user and current role assignment in one server-only round-trip.';

-- Keep the state endpoint's multiplier mathematically identical to the engine tick.
CREATE OR REPLACE FUNCTION aviator.get_aviator_state_bundle()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
  WITH recent_rounds AS (
    SELECT id, game_code, round_number, status, crash_multiplier, started_at, ended_at,
           server_seed_hash, revealed_server_seed, multiplier_tick_seq
      FROM aviator.game_rounds
     WHERE game_code = 'aviator'
     ORDER BY round_number DESC
     LIMIT 25
  ),
  current_round AS (
    SELECT *
      FROM recent_rounds
     ORDER BY CASE WHEN status IN ('RUNNING', 'WAITING') THEN 0 ELSE 1 END,
              round_number DESC
     LIMIT 1
  ),
  current_bets AS (
    SELECT b.id, b.round_id, b.bet_amount, b.auto_cashout, b.status,
           b.payout_amount, b.cashed_out_at, b.created_at, u.username
      FROM aviator.game_bets AS b
      JOIN current_round AS r ON r.id = b.round_id
      LEFT JOIN platform.users AS u ON u.id = b.user_id
     ORDER BY b.created_at DESC
     LIMIT 100
  )
  SELECT jsonb_build_object(
    'rounds',
      COALESCE((SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.round_number DESC) FROM recent_rounds AS rr), '[]'::jsonb),
    'round',
      (SELECT to_jsonb(cr) || jsonb_build_object(
        'multiplier',
        CASE
          WHEN cr.status = 'RUNNING' THEN LEAST(
            floor(exp(0.06 * power(greatest(0::numeric, extract(epoch FROM (now() - cr.started_at))::numeric), 1.15)) * 100) / 100,
            cr.crash_multiplier
          )
          WHEN cr.status IN ('CRASHED', 'SETTLED') THEN COALESCE(cr.crash_multiplier, 1)
          ELSE 1
        END
      ) FROM current_round AS cr),
    'bets',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cb.id,
          'round_id', cb.round_id,
          'bet_amount', cb.bet_amount,
          'auto_cashout', cb.auto_cashout,
          'status', cb.status,
          'payout_amount', cb.payout_amount,
          'cashed_out_at', cb.cashed_out_at,
          'username', COALESCE(cb.username, 'Player')
        ) ORDER BY cb.created_at DESC)
        FROM current_bets AS cb
      ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION aviator.get_aviator_state_bundle() FROM PUBLIC;
REVOKE ALL ON FUNCTION aviator.get_aviator_state_bundle() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.get_aviator_state_bundle() TO service_role, postgres;

-- Return the exact multiplier included in the public Realtime payload so the
-- worker can sample engine-vs-broadcast parity without logging every tick.
CREATE OR REPLACE FUNCTION aviator.tick_crash_engine_with_broadcast()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
  v_round_id uuid;
  v_payload jsonb;
BEGIN
  v_result := aviator.tick_crash_engine();

  IF COALESCE(v_result->>'action', '') = 'round_running'
     AND NULLIF(v_result->>'roundId', '') IS NOT NULL
     AND NULLIF(v_result->>'multiplier', '') IS NOT NULL THEN
    v_round_id := (v_result->>'roundId')::uuid;

    UPDATE aviator.game_rounds AS r
    SET multiplier_tick_seq = r.multiplier_tick_seq + 1,
        last_multiplier_broadcast_at = clock_timestamp()
    WHERE r.id = v_round_id
      AND r.status = 'RUNNING'
      AND (
        r.last_multiplier_broadcast_at IS NULL
        OR r.last_multiplier_broadcast_at <= clock_timestamp() - interval '1 second'
      )
    RETURNING jsonb_build_object(
      'id', r.id,
      'roundNumber', r.round_number,
      'status', r.status::text,
      'startedAt', r.started_at,
      'endedAt', r.ended_at,
      'serverSeedHash', r.server_seed_hash,
      'revealedServerSeed', CASE
        WHEN r.revealed_server_seed IS NOT NULL THEN r.revealed_server_seed
        ELSE NULL
      END,
      'multiplier', (v_result->>'multiplier')::numeric,
      'tickSequence', r.multiplier_tick_seq,
      'serverTime', clock_timestamp()
    ) INTO v_payload;

    IF v_payload IS NOT NULL THEN
      PERFORM realtime.send(v_payload, 'round_state_changed', 'aviator:rounds', false);
      v_result := v_result || jsonb_build_object(
        'broadcastMultiplier', v_payload->'multiplier',
        'broadcastTickSequence', v_payload->'tickSequence'
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION aviator.tick_crash_engine_with_broadcast() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.tick_crash_engine_with_broadcast() TO service_role;
