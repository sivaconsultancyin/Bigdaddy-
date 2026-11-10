-- Durable, server-authoritative Lucky 10 Dice round lifecycle and settlement.
-- Uses the existing platform game catalog, wallet escrow, and atomic wallet ledger.
BEGIN;

CREATE OR REPLACE FUNCTION dice.advance_round()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_game_status text;
  v_pool_wallet_id uuid;
  v_mapped_pool_wallet_id uuid;
  v_pool_wallet_type text;
  v_pool_game_code text;
  v_escrow_wallet_id uuid;
  v_player_wallet_id uuid;
  v_round dice.authoritative_game_rounds%ROWTYPE;
  v_has_round boolean := false;
  v_bet dice.authoritative_game_bets%ROWTYPE;
  v_seed text;
  v_seed_hash text;
  v_hmac_hex text;
  v_roll integer;
  v_type text;
  v_selected integer;
  v_won boolean;
  v_multiplier bigint;
  v_expected_liability bigint;
  v_gross bigint;
  v_profit bigint;
  v_payout_tx uuid;
  v_stake_tx uuid;
  v_history jsonb;
BEGIN
  -- Serialize all round transitions. Bet placement separately locks the current
  -- round before touching pool/player/escrow wallets.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dice-round-lifecycle-v1'));

  SELECT g.status, g.pool_wallet_id
    INTO v_game_status, v_pool_wallet_id
  FROM platform.games AS g
  WHERE g.code = 'dice'
  FOR UPDATE;

  IF NOT FOUND OR v_game_status <> 'ACTIVE' OR v_pool_wallet_id IS NULL THEN
    RETURN jsonb_build_object(
      'gameCode', 'dice',
      'status', 'COMING_SOON',
      'gameStateUnavailable', true,
      'round', NULL
    );
  END IF;

  SELECT gp.wallet_id
    INTO v_mapped_pool_wallet_id
  FROM platform.game_pools AS gp
  WHERE gp.game_code = 'dice';
  SELECT w.wallet_type::text, w.game_code
    INTO v_pool_wallet_type, v_pool_game_code
  FROM wallet.wallets AS w
  WHERE w.id = v_pool_wallet_id;
  IF v_mapped_pool_wallet_id IS DISTINCT FROM v_pool_wallet_id THEN
    RAISE EXCEPTION 'DICE_POOL_MAPPING_MISMATCH';
  END IF;
  IF v_pool_wallet_type IS DISTINCT FROM 'GAME_POOL'
     OR v_pool_game_code IS DISTINCT FROM 'dice' THEN
    RAISE EXCEPTION 'DICE_POOL_IDENTITY_MISMATCH';
  END IF;

  SELECT w.id
    INTO v_escrow_wallet_id
  FROM wallet.wallets AS w
  WHERE w.wallet_type = 'ESCROW'
  ORDER BY w.id
  LIMIT 1;

  IF v_escrow_wallet_id IS NULL THEN
    RAISE EXCEPTION 'DICE_ESCROW_WALLET_MISSING';
  END IF;

  SELECT *
    INTO v_round
  FROM dice.authoritative_game_rounds
  WHERE game_code = 'dice'
  ORDER BY round_number DESC
  LIMIT 1
  FOR UPDATE;
  v_has_round := FOUND;

  -- Close betting and persist the authoritative result. The result is not
  -- exposed by the API until settlement completes.
  IF v_has_round
     AND v_round.status = 'BETTING'
     AND v_round.betting_closes_at <= clock_timestamp() THEN
    v_seed := v_round.server_seed;
    IF v_seed IS NULL
       OR encode(extensions.digest(v_seed, 'sha256'), 'hex') <> v_round.server_seed_hash THEN
      RAISE EXCEPTION 'DICE_SERVER_SEED_HASH_MISMATCH';
    END IF;

    v_hmac_hex := encode(extensions.hmac('dice', v_seed, 'sha256'), 'hex');
    v_roll := (
      (('x' || substr(v_hmac_hex, 1, 13))::bit(52)::bigint % 10) + 1
    )::integer;

    UPDATE dice.authoritative_game_rounds
    SET status = 'RUNNING',
        result = jsonb_build_object('number', v_roll, 'rolledNumber', v_roll),
        state = state || jsonb_build_object('rollStartedAt', clock_timestamp())
    WHERE id = v_round.id
    RETURNING * INTO v_round;
    v_has_round := true;
  END IF;

  -- Keep the rolling animation visible for 4.5 seconds, then settle every bet
  -- in this round in the same database transaction.
  IF v_has_round
     AND v_round.status = 'RUNNING'
     AND NULLIF(v_round.state->>'rollStartedAt', '') IS NOT NULL
     AND (v_round.state->>'rollStartedAt')::timestamptz
           <= clock_timestamp() - interval '4500 milliseconds' THEN
    v_seed := v_round.server_seed;
    IF v_seed IS NULL
       OR encode(extensions.digest(v_seed, 'sha256'), 'hex') <> v_round.server_seed_hash THEN
      RAISE EXCEPTION 'DICE_SERVER_SEED_HASH_MISMATCH';
    END IF;

    v_hmac_hex := encode(extensions.hmac('dice', v_seed, 'sha256'), 'hex');
    v_roll := (
      (('x' || substr(v_hmac_hex, 1, 13))::bit(52)::bigint % 10) + 1
    )::integer;

    IF v_roll <> (v_round.result->>'number')::integer THEN
      RAISE EXCEPTION 'DICE_RESULT_INTEGRITY_MISMATCH';
    END IF;

    FOR v_bet IN
      SELECT *
      FROM dice.authoritative_game_bets
      WHERE round_id = v_round.id
        AND status = 'PENDING'
      ORDER BY id
      FOR UPDATE
    LOOP
      v_type := lower(coalesce(v_bet.selection->>'type', ''));
      v_selected := NULL;
      v_multiplier := 0;
      v_won := false;

      IF v_type ~ '^[0-9]+$' THEN
        v_selected := v_type::integer;
        IF v_selected NOT BETWEEN 1 AND 10 THEN
          RAISE EXCEPTION 'DICE_BET_SELECTION_INVALID';
        END IF;
        v_won := v_selected = v_roll;
        v_multiplier := 9; -- Existing Lucky 10 UI rule: 9x gross payout.
        v_expected_liability := v_bet.bet_amount * 10;
      ELSIF v_type = 'small' THEN
        v_won := v_roll BETWEEN 1 AND 5;
        v_multiplier := 2;
        v_expected_liability := v_bet.bet_amount * 2;
      ELSIF v_type = 'big' THEN
        v_won := v_roll BETWEEN 6 AND 10;
        v_multiplier := 2;
        v_expected_liability := v_bet.bet_amount * 2;
      ELSIF v_type = 'even' THEN
        v_won := v_roll % 2 = 0;
        v_multiplier := 2;
        v_expected_liability := v_bet.bet_amount * 2;
      ELSIF v_type = 'odd' THEN
        v_won := v_roll % 2 = 1;
        v_multiplier := 2;
        v_expected_liability := v_bet.bet_amount * 2;
      ELSE
        RAISE EXCEPTION 'DICE_BET_SELECTION_INVALID';
      END IF;

      IF v_bet.reserved_liability IS DISTINCT FROM v_expected_liability THEN
        RAISE EXCEPTION 'DICE_RESERVED_LIABILITY_MISMATCH';
      END IF;

      v_gross := CASE WHEN v_won THEN v_bet.bet_amount * v_multiplier ELSE 0 END;
      v_profit := CASE WHEN v_won THEN v_gross - v_bet.bet_amount ELSE 0 END;
      v_payout_tx := NULL;
      v_stake_tx := NULL;

      SELECT w.id
        INTO v_player_wallet_id
      FROM wallet.wallets AS w
      WHERE w.user_id = v_bet.user_id
        AND w.wallet_type = 'PLAYER'
      ORDER BY w.id
      LIMIT 1;

      IF v_player_wallet_id IS NULL THEN
        RAISE EXCEPTION 'DICE_PLAYER_WALLET_MISSING';
      END IF;

      IF v_won THEN
        -- Return the player's stake, then pay the net winnings from the
        -- game pool. The pool's reserved liability covers the payout.
        SELECT wallet.wallet_transfer_atomic(
          'DICE_STAKE_RETURN_' || replace(v_bet.id::text, '-', ''),
          'BET_ESCROW_REFUND'::public.transaction_type_enum,
          v_bet.bet_amount,
          v_escrow_wallet_id,
          v_player_wallet_id,
          jsonb_build_object(
            'gameCode', 'dice',
            'roundId', v_round.id,
            'betId', v_bet.id,
            'reason', 'winning stake return'
          )
        ) INTO v_stake_tx;

        IF v_profit > 0 THEN
          SELECT wallet.wallet_transfer_atomic(
            'DICE_PAYOUT_' || replace(v_bet.id::text, '-', ''),
            'BET_WIN_PAYOUT'::public.transaction_type_enum,
            v_profit,
            v_pool_wallet_id,
            v_player_wallet_id,
            jsonb_build_object(
              'gameCode', 'dice',
              'roundId', v_round.id,
              'betId', v_bet.id,
              'rolledNumber', v_roll,
              'grossPayout', v_gross::text
            )
          ) INTO v_payout_tx;
        END IF;
      ELSE
        -- Losing stakes leave escrow and become game-pool funds.
        SELECT wallet.wallet_transfer_atomic(
          'DICE_LOSS_' || replace(v_bet.id::text, '-', ''),
          'BET_LOSS_GAME_POOL'::public.transaction_type_enum,
          v_bet.bet_amount,
          v_escrow_wallet_id,
          v_pool_wallet_id,
          jsonb_build_object(
            'gameCode', 'dice',
            'roundId', v_round.id,
            'betId', v_bet.id,
            'rolledNumber', v_roll
          )
        ) INTO v_stake_tx;
      END IF;

      UPDATE dice.authoritative_game_bets
      SET status = CASE WHEN v_won THEN 'WON' ELSE 'LOST' END,
          payout_amount = v_gross,
          payout_transaction_id = v_payout_tx,
          stake_release_transaction_id = v_stake_tx,
          settled_at = clock_timestamp()
      WHERE id = v_bet.id;

      UPDATE wallet.wallets
      SET reserved_balance = reserved_balance - v_bet.reserved_liability,
          updated_at = clock_timestamp()
      WHERE id = v_pool_wallet_id
        AND reserved_balance >= v_bet.reserved_liability;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'DICE_RESERVED_LIABILITY_MISMATCH';
      END IF;
    END LOOP;

    UPDATE dice.authoritative_game_rounds
    SET status = 'SETTLED',
        settled_at = clock_timestamp(),
        server_seed = v_seed,
        result = jsonb_build_object('number', v_roll, 'rolledNumber', v_roll),
        state = state || jsonb_build_object('settlementComplete', true)
    WHERE id = v_round.id
    RETURNING * INTO v_round;
    v_has_round := true;
  END IF;

  -- Keep the result visible for five seconds before opening the next round.
  IF NOT v_has_round
     OR (
       v_round.status IN ('SETTLED', 'CANCELLED')
       AND (v_round.settled_at IS NULL
            OR v_round.settled_at <= clock_timestamp() - interval '5 seconds')
     ) THEN
    v_seed := encode(extensions.gen_random_bytes(32), 'hex');
    v_seed_hash := encode(extensions.digest(v_seed, 'sha256'), 'hex');

    INSERT INTO dice.authoritative_game_rounds (
      game_code, round_number, status, state, server_seed_hash, server_seed,
      opened_at, betting_closes_at
    )
    SELECT
      'dice',
      coalesce(max(round_number), 0) + 1,
      'BETTING',
      jsonb_build_object('totalBetsCount', 0, 'totalBetAmount', '0'),
      v_seed_hash,
      v_seed,
      clock_timestamp(),
      clock_timestamp() + interval '14 seconds'
    FROM dice.authoritative_game_rounds
    RETURNING * INTO v_round;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'roundNumber', h.round_number,
        'result', h.result,
        'timestamp', h.settled_at
      )
      ORDER BY h.round_number DESC
    ),
    '[]'::jsonb
  )
  INTO v_history
  FROM (
    SELECT round_number, result, settled_at
    FROM dice.authoritative_game_rounds
    WHERE status = 'SETTLED'
    ORDER BY round_number DESC
    LIMIT 25
  ) AS h;

  RETURN jsonb_build_object(
    'gameCode', 'dice',
    'status', 'ACTIVE',
    'round', jsonb_build_object(
      'id', v_round.id,
      'roundNumber', v_round.round_number,
      'status', v_round.status,
      'openedAt', v_round.opened_at,
      'bettingEndsAt', v_round.betting_closes_at,
      'result', CASE WHEN v_round.status = 'SETTLED' THEN v_round.result ELSE NULL END,
      'serverSeedHash', v_round.server_seed_hash,
      'revealedServerSeed', CASE WHEN v_round.status = 'SETTLED' THEN v_round.server_seed ELSE NULL END
    ),
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION dice.advance_round() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dice.advance_round() TO service_role;
COMMENT ON FUNCTION dice.advance_round() IS
  'Advances Lucky 10 Dice rounds and atomically settles escrow and pool liabilities using the authoritative server seed.';

COMMIT;
