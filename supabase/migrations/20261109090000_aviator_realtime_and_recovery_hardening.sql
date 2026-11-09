-- Remove the hidden crash target from public lifecycle broadcasts while
-- retaining the authoritative live multiplier on RUNNING tick events.
-- Also recover stale WAITING rounds through the existing audited escrow-refund
-- primitive. Any mismatch is logged and keeps the scheduler fail-closed.

CREATE OR REPLACE FUNCTION aviator.broadcast_public_round_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'id', new.id,
    'roundNumber', new.round_number,
    'status', new.status::text,
    'startedAt', new.started_at,
    'endedAt', new.ended_at,
    'serverSeedHash', new.server_seed_hash,
    'revealedServerSeed', CASE WHEN new.revealed_server_seed IS NOT NULL
      THEN new.revealed_server_seed ELSE NULL END
  ) || CASE
    WHEN new.status::text IN ('CRASHED', 'SETTLED')
      THEN jsonb_build_object('crashMultiplier', new.crash_multiplier)
    ELSE '{}'::jsonb
  END;

  PERFORM realtime.send(
    v_payload,
    'round_state_changed',
    'aviator:rounds',
    false
  );
  RETURN new;
END;
$function$;

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
    SELECT jsonb_build_object(
      'id', r.id,
      'roundNumber', r.round_number,
      'status', r.status::text,
      'startedAt', r.started_at,
      'endedAt', r.ended_at,
      'serverSeedHash', r.server_seed_hash,
      'revealedServerSeed', CASE WHEN r.revealed_server_seed IS NOT NULL
        THEN r.revealed_server_seed ELSE NULL END,
      'multiplier', (v_result->>'multiplier')::numeric
    )
    INTO v_payload
    FROM aviator.game_rounds AS r
    WHERE r.id = v_round_id AND r.status = 'RUNNING';

    IF v_payload IS NOT NULL THEN
      PERFORM realtime.send(v_payload, 'round_state_changed', 'aviator:rounds', false);
    END IF;
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION aviator.tick_crash_engine_with_broadcast() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.tick_crash_engine_with_broadcast() TO service_role;

-- The refund primitive performs strict escrow-lock, player-wallet, settlement,
-- pool-liability and row-lock validation. This wrapper adds durable audit events.
CREATE OR REPLACE FUNCTION aviator.recover_stale_waiting_rounds(p_stale_after_seconds integer DEFAULT 120)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_round record;
  v_result jsonb;
  v_error text;
  v_recovered integer := 0;
  v_blocked integer := 0;
BEGIN
  IF p_stale_after_seconds < 120 OR p_stale_after_seconds > 86400 THEN
    RAISE EXCEPTION 'INVALID_STALE_WAITING_THRESHOLD';
  END IF;

  FOR v_round IN
    SELECT r.id
    FROM aviator.game_rounds AS r
    WHERE r.game_code = 'aviator'
      AND r.status = 'WAITING'
      AND r.started_at < clock_timestamp() - make_interval(secs => p_stale_after_seconds)
      AND EXISTS (
        SELECT 1 FROM aviator.game_bets AS b
        WHERE b.round_id = r.id AND b.status = 'PENDING'
      )
    ORDER BY r.started_at, r.id
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    BEGIN
      v_result := aviator.refund_stale_waiting_round_pending_bets(v_round.id);
      INSERT INTO platform.system_health_events (
        id, request_id, method, path, status_code, duration_ms,
        component, reason_code, reason, recovery
      ) VALUES (
        gen_random_uuid(),
        'aviator-stale-recovery-' || v_round.id::text,
        'SYSTEM',
        '/internal/aviator/recovery',
        200,
        0,
        'aviator-engine',
        'STALE_WAITING_ROUND_REFUNDED',
        'Stale WAITING round pending bets were refunded after escrow and liability validation.',
        v_result::text
      );
      v_recovered := v_recovered + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      INSERT INTO platform.system_health_events (
        id, request_id, method, path, status_code, duration_ms,
        component, reason_code, reason, recovery
      ) VALUES (
        gen_random_uuid(),
        'aviator-stale-recovery-blocked-' || v_round.id::text,
        'SYSTEM',
        '/internal/aviator/recovery',
        409,
        0,
        'aviator-engine',
        'STALE_WAITING_REFUND_BLOCKED',
        left(v_error, 1000),
        'No bet or wallet state was committed for this round; scheduler remains blocked for manual reconciliation.'
      );
      v_blocked := v_blocked + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'recoveredRounds', v_recovered,
    'blockedRounds', v_blocked
  );
END;
$function$;

REVOKE ALL ON FUNCTION aviator.recover_stale_waiting_rounds(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.recover_stale_waiting_rounds(integer) TO service_role;

-- Keep the scheduler fail-closed: run recovery first, then start the engine only
-- when no stale WAITING round still has pending bets (i.e. every refund validated).
DO $scheduler$
DECLARE
  existing_job bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'aviator_engine_secret'
      AND length(decrypted_secret) >= 32
  ) THEN
    RAISE EXCEPTION 'aviator_engine_secret is missing or invalid; scheduler not updated';
  END IF;

  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'bigdaddy-aviator-engine'
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;

  PERFORM cron.schedule(
    'bigdaddy-aviator-engine',
    '* * * * *',
    $command$
      WITH recovery AS MATERIALIZED (
        SELECT aviator.recover_stale_waiting_rounds(120) AS result
      )
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM aviator.game_rounds r
          JOIN aviator.game_bets b ON b.round_id = r.id
          WHERE r.game_code = 'aviator'
            AND r.status = 'WAITING'
            AND b.status = 'PENDING'
            AND r.started_at < now() - interval '2 minutes'
        )
        THEN net.http_post(
          url := 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/aviator-engine',
          body := '{}'::jsonb,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-aviator-engine-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aviator_engine_secret' LIMIT 1)
          ),
          timeout_milliseconds := 60000
        )
        ELSE NULL::bigint
      END
      FROM recovery;
    $command$
  );
END
$scheduler$;
