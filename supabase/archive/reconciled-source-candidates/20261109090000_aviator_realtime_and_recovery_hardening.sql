-- Remove the hidden crash target from public lifecycle broadcasts while
-- retaining the authoritative live multiplier on RUNNING tick events.
-- Also recover stale WAITING rounds through the existing audited escrow-refund
-- primitive. Any mismatch is logged and keeps the scheduler fail-closed.

-- Track the existing production refund primitive in source control as well.
-- It is intentionally strict and transactional: any escrow, wallet, settlement,
-- or reserved-liability mismatch aborts the whole round refund.
CREATE OR REPLACE FUNCTION aviator.refund_stale_waiting_round_pending_bets(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_round aviator.game_rounds%ROWTYPE;
  v_pool_wallet uuid;
  v_escrow_wallet uuid;
  v_total_liability bigint := 0;
  v_refund_total bigint := 0;
  v_count integer := 0;
  v_bet record;
  v_lock_tx wallet.wallet_transactions%ROWTYPE;
  v_refund_tx uuid;
  v_player_wallet uuid;
  v_expected_liability bigint;
  v_locked_wallets integer;
  v_expected_wallet_locks integer;
BEGIN
  IF p_round_id IS NULL THEN RAISE EXCEPTION 'ROUND_ID_REQUIRED'; END IF;
  SELECT * INTO v_round
  FROM aviator.game_rounds
  WHERE id = p_round_id AND game_code = 'aviator'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AVIATOR_ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'WAITING' THEN RAISE EXCEPTION 'ROUND_NOT_WAITING: %', v_round.status; END IF;
  IF v_round.started_at >= now() - interval '2 minutes' THEN RAISE EXCEPTION 'ROUND_NOT_STALE'; END IF;
  IF v_round.revealed_server_seed IS NOT NULL OR v_round.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_HAS_STARTED_OR_ENDED';
  END IF;

  SELECT pool_wallet_id INTO v_pool_wallet
  FROM platform.games
  WHERE code = 'aviator' AND status = 'ACTIVE';
  IF v_pool_wallet IS NULL THEN RAISE EXCEPTION 'AVIATOR_POOL_NOT_FOUND'; END IF;
  SELECT id INTO v_escrow_wallet
  FROM wallet.wallets
  WHERE wallet_type = 'ESCROW'
  ORDER BY id LIMIT 1;
  IF v_escrow_wallet IS NULL THEN RAISE EXCEPTION 'ESCROW_WALLET_NOT_FOUND'; END IF;

  FOR v_bet IN
    SELECT b.* FROM aviator.game_bets b
    WHERE b.round_id = p_round_id AND b.status = 'PENDING'
    ORDER BY b.id FOR UPDATE
  LOOP
    SELECT * INTO v_lock_tx FROM wallet.wallet_transactions
    WHERE idempotency_key = 'BET_LOCK_' || v_bet.idempotency_key;
    IF NOT FOUND OR v_lock_tx.type <> 'BET_ESCROW_LOCK'
       OR v_lock_tx.amount <> v_bet.bet_amount
       OR v_lock_tx.target_wallet_id <> v_escrow_wallet
       OR v_lock_tx.source_wallet_id IS NULL THEN
      RAISE EXCEPTION 'BET_ESCROW_LOCK_MISMATCH: %', v_bet.id;
    END IF;
    SELECT id INTO v_player_wallet
    FROM wallet.wallets
    WHERE id = v_lock_tx.source_wallet_id
      AND user_id = v_bet.user_id
      AND wallet_type = 'PLAYER';
    IF v_player_wallet IS NULL THEN RAISE EXCEPTION 'PLAYER_WALLET_MISMATCH: %', v_bet.id; END IF;
    IF EXISTS (SELECT 1 FROM aviator.game_settlements s WHERE s.bet_id = v_bet.id) THEN
      RAISE EXCEPTION 'BET_ALREADY_HAS_SETTLEMENT: %', v_bet.id;
    END IF;
    v_expected_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
    v_total_liability := v_total_liability + v_expected_liability;
    v_refund_total := v_refund_total + v_bet.bet_amount;
  END LOOP;

  IF v_total_liability = 0 THEN
    RETURN jsonb_build_object(
      'roundId', p_round_id, 'refundedBets', 0,
      'refundAmount', 0, 'releasedLiability', 0
    );
  END IF;

  PERFORM w.id
  FROM wallet.wallets w
  WHERE w.id = v_pool_wallet OR w.id = v_escrow_wallet
     OR w.id IN (
       SELECT wt.source_wallet_id
       FROM aviator.game_bets b
       JOIN wallet.wallet_transactions wt
         ON wt.idempotency_key = 'BET_LOCK_' || b.idempotency_key
       WHERE b.round_id = p_round_id AND b.status = 'PENDING'
     )
  ORDER BY w.id FOR UPDATE;
  GET DIAGNOSTICS v_locked_wallets = ROW_COUNT;
  SELECT 2 + count(DISTINCT wt.source_wallet_id) INTO v_expected_wallet_locks
  FROM aviator.game_bets b
  JOIN wallet.wallet_transactions wt
    ON wt.idempotency_key = 'BET_LOCK_' || b.idempotency_key
  WHERE b.round_id = p_round_id AND b.status = 'PENDING';
  IF v_locked_wallets <> v_expected_wallet_locks THEN
    RAISE EXCEPTION 'WALLET_LOCK_SET_INCOMPLETE';
  END IF;
  IF (SELECT reserved_balance FROM wallet.wallets WHERE id = v_pool_wallet) < v_total_liability THEN
    RAISE EXCEPTION 'POOL_RESERVED_LIABILITY_MISMATCH';
  END IF;

  FOR v_bet IN
    SELECT b.*, wt.source_wallet_id AS player_wallet_id, wt.id AS lock_transaction_id
    FROM aviator.game_bets b
    JOIN wallet.wallet_transactions wt
      ON wt.idempotency_key = 'BET_LOCK_' || b.idempotency_key
    WHERE b.round_id = p_round_id AND b.status = 'PENDING'
    ORDER BY b.id FOR UPDATE OF b
  LOOP
    v_expected_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
    v_refund_tx := wallet.wallet_transfer_atomic(
      'BET_REFUND_' || replace(v_bet.id::text, '-', ''),
      'BET_ESCROW_REFUND'::public.transaction_type_enum,
      v_bet.bet_amount,
      v_escrow_wallet,
      v_bet.player_wallet_id,
      jsonb_build_object(
        'betId', v_bet.id,
        'roundId', p_round_id,
        'reason', 'stale_waiting_round_refund',
        'originalEscrowLockId', v_bet.lock_transaction_id
      )
    );
    UPDATE wallet.wallets
    SET reserved_balance = reserved_balance - v_expected_liability, updated_at = now()
    WHERE id = v_pool_wallet AND reserved_balance >= v_expected_liability;
    IF NOT FOUND THEN RAISE EXCEPTION 'POOL_RESERVATION_RELEASE_FAILED: %', v_bet.id; END IF;
    UPDATE aviator.game_bets
    SET status = 'CANCELLED', payout_amount = 0
    WHERE id = v_bet.id AND status = 'PENDING';
    IF NOT FOUND THEN RAISE EXCEPTION 'BET_STATE_CHANGED: %', v_bet.id; END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'roundId', p_round_id,
    'refundedBets', v_count,
    'refundAmount', v_refund_total,
    'releasedLiability', v_total_liability,
    'status', 'CANCELLED_AND_REFUNDED'
  );
END;
$function$;

REVOKE ALL ON FUNCTION aviator.refund_stale_waiting_round_pending_bets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.refund_stale_waiting_round_pending_bets(uuid) TO service_role;

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
