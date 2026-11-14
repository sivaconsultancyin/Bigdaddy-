-- Move Aviator round-state transitions, fairness generation, and auto-cashout orchestration
-- into Supabase PostgreSQL. A trusted persistent scheduler calls this RPC approximately
-- once per second; the function itself serializes ticks and keeps wallet settlement atomic.

CREATE OR REPLACE FUNCTION aviator.tick_crash_engine()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_round record;
  v_game record;
  v_round_id uuid;
  v_round_number bigint;
  v_seed text;
  v_commitment text;
  v_hmac_hex text;
  v_hmac_bytes bytea;
  v_hmac_integer bigint;
  v_value numeric;
  v_crash numeric;
  v_age_seconds numeric;
  v_multiplier numeric;
  v_bet record;
  v_error text;
  v_settled_count integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('bigdaddy:aviator:round-engine', 0)) THEN
    RETURN jsonb_build_object('action', 'busy');
  END IF;

  -- Recover a previously committed CRASHED state before doing any other work.
  SELECT id INTO v_round_id
  FROM aviator.game_rounds
  WHERE game_code = 'aviator' AND status = 'CRASHED'
  ORDER BY round_number DESC
  LIMIT 1;

  IF v_round_id IS NOT NULL THEN
    v_settled_count := aviator.settle_crash_round_atomic(v_round_id);
    RETURN jsonb_build_object('action', 'settled_recovery', 'roundId', v_round_id, 'betsSettled', v_settled_count);
  END IF;

  SELECT id, pool_wallet_id INTO v_game
  FROM platform.games
  WHERE code = 'aviator' AND status = 'ACTIVE'
  LIMIT 1;

  IF NOT FOUND OR v_game.pool_wallet_id IS NULL THEN
    RETURN jsonb_build_object('action', 'game_inactive');
  END IF;

  SELECT
    id, round_number, status, started_at, ended_at, server_seed, crash_multiplier,
    EXTRACT(EPOCH FROM (now() - started_at)) AS elapsed_seconds,
    EXTRACT(EPOCH FROM (now() - ended_at)) AS seconds_since_end
  INTO v_round
  FROM aviator.game_rounds
  WHERE game_code = 'aviator'
  ORDER BY round_number DESC
  LIMIT 1;

  -- Use a 4-second post-crash cooldown.
  IF FOUND
     AND v_round.status = 'SETTLED'
     AND v_round.ended_at IS NOT NULL
     AND v_round.seconds_since_end >= 0
     AND v_round.seconds_since_end < 4 THEN
    RETURN jsonb_build_object('action', 'cooldown', 'roundNumber', v_round.round_number);
  END IF;

  IF NOT FOUND OR v_round.status = 'SETTLED' THEN
    SELECT COALESCE(MAX(round_number), 0)::bigint + 1 INTO v_round_number
    FROM aviator.game_rounds
    WHERE game_code = 'aviator';

    v_seed := encode(extensions.gen_random_bytes(32), 'hex');
    v_commitment := encode(extensions.digest(v_seed, 'sha256'), 'hex');
    v_hmac_hex := encode(extensions.hmac(v_round_number::text, v_seed, 'sha256'), 'hex');
    v_hmac_bytes := decode(substr(v_hmac_hex, 1, 14), 'hex');
    v_hmac_integer :=
        (get_byte(v_hmac_bytes, 0)::bigint << 48)
      + (get_byte(v_hmac_bytes, 1)::bigint << 40)
      + (get_byte(v_hmac_bytes, 2)::bigint << 32)
      + (get_byte(v_hmac_bytes, 3)::bigint << 24)
      + (get_byte(v_hmac_bytes, 4)::bigint << 16)
      + (get_byte(v_hmac_bytes, 5)::bigint << 8)
      +  get_byte(v_hmac_bytes, 6)::bigint;
    v_value := (v_hmac_integer >> 4)::numeric / 4503599627370496::numeric;
    v_crash := LEAST(
      50::numeric,
      GREATEST(
        1::numeric,
        floor((0.97::numeric / GREATEST(0.000000000001::numeric, 1 - v_value)) * 100) / 100
      )
    );

    INSERT INTO aviator.game_rounds (
      game_code, round_number, status, server_seed, server_seed_hash, crash_multiplier, started_at
    )
    VALUES ('aviator', v_round_number, 'WAITING', v_seed, v_commitment, v_crash, now())
    RETURNING id INTO v_round_id;

    RETURN jsonb_build_object('action', 'round_created', 'roundId', v_round_id, 'roundNumber', v_round_number);
  END IF;

  v_age_seconds := GREATEST(0::numeric, COALESCE(v_round.elapsed_seconds, 0));

  IF v_round.status = 'WAITING' THEN
    IF v_age_seconds >= 5 THEN
      UPDATE aviator.game_rounds
      SET status = 'RUNNING', started_at = now()
      WHERE id = v_round.id AND status = 'WAITING';

      IF FOUND THEN
        RETURN jsonb_build_object('action', 'round_started', 'roundId', v_round.id, 'roundNumber', v_round.round_number);
      END IF;
    END IF;
    RETURN jsonb_build_object('action', 'waiting', 'roundId', v_round.id, 'roundNumber', v_round.round_number);
  END IF;

  IF v_round.status = 'RUNNING' THEN
    v_multiplier := floor(exp(0.06 * power(v_age_seconds, 1.15)) * 100) / 100;

    IF v_multiplier >= v_round.crash_multiplier THEN
      UPDATE aviator.game_rounds
      SET status = 'CRASHED',
          ended_at = now(),
          revealed_server_seed = server_seed
      WHERE id = v_round.id AND status = 'RUNNING';

      RETURN jsonb_build_object(
        'action', 'round_crashed',
        'roundId', v_round.id,
        'roundNumber', v_round.round_number,
        'crashMultiplier', v_round.crash_multiplier
      );
    END IF;

    FOR v_bet IN
      SELECT id, user_id
      FROM aviator.game_bets
      WHERE round_id = v_round.id
        AND status = 'PENDING'
        AND auto_cashout IS NOT NULL
        AND auto_cashout <= v_multiplier
    LOOP
      BEGIN
        PERFORM aviator.cashout_crash_bet_atomic(
          v_bet.user_id,
          v_bet.id,
          'AUTO_CASHOUT_' || replace(v_bet.id::text, '-', '')
        );
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        IF position('ROUND_ALREADY_CRASHED' IN v_error) = 0
           AND position('BET_ALREADY_SETTLED' IN v_error) = 0 THEN
          RAISE;
        END IF;
      END;
    END LOOP;

    RETURN jsonb_build_object('action', 'round_running', 'roundId', v_round.id, 'roundNumber', v_round.round_number, 'multiplier', v_multiplier);
  END IF;

  RETURN jsonb_build_object('action', 'no_op', 'roundId', v_round.id, 'status', v_round.status);
END
$function$;

REVOKE ALL ON FUNCTION aviator.tick_crash_engine() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.tick_crash_engine() TO service_role;
COMMENT ON FUNCTION aviator.tick_crash_engine() IS
  'Advances one Aviator round-engine tick atomically. Invoke from a trusted persistent scheduler approximately once per second.';
