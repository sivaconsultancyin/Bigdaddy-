-- Throttle public Aviator multiplier broadcasts to at most one per second.
-- The authoritative engine RPC continues ticking at its existing cadence so
-- crash detection and auto-cashout checks retain their current precision.
-- Only the public Realtime fan-out and its sequence-row write are throttled.
ALTER TABLE aviator.game_rounds
  ADD COLUMN IF NOT EXISTS last_multiplier_broadcast_at timestamptz;

CREATE OR REPLACE FUNCTION aviator.tick_crash_engine_with_broadcast()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION aviator.tick_crash_engine_with_broadcast() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.tick_crash_engine_with_broadcast() TO service_role;
