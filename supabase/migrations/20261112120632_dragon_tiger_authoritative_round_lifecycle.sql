-- Durable Dragon Tiger rounds, committed deck generation and atomic settlement.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION dragon_tiger.advance_round()
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
  v_round dragon_tiger.authoritative_game_rounds%ROWTYPE;
  v_has_round boolean := false;
  v_bet dragon_tiger.authoritative_game_bets%ROWTYPE;
  v_seed text;
  v_seed_hash text;
  v_deck jsonb := '[]'::jsonb;
  v_suits text[] := ARRAY['S','H','D','C'];
  v_ranks text[] := ARRAY['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  v_i integer;
  v_j integer;
  v_rank integer;
  v_suit text;
  v_hmac_hex text;
  v_card_i jsonb;
  v_card_j jsonb;
  v_dragon_card jsonb;
  v_tiger_card jsonb;
  v_dragon_value integer;
  v_tiger_value integer;
  v_winner text;
  v_type text;
  v_won boolean;
  v_multiplier bigint;
  v_expected_liability bigint;
  v_gross bigint;
  v_profit bigint;
  v_payout_tx uuid;
  v_stake_tx uuid;
  v_history jsonb;
BEGIN
  -- One transaction at a time may advance the Dragon Tiger lifecycle.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dragon-tiger-round-lifecycle-v1'));

  SELECT g.status, g.pool_wallet_id
    INTO v_game_status, v_pool_wallet_id
  FROM platform.games AS g
  WHERE g.code = 'dragon_tiger'
  FOR UPDATE;

  IF NOT FOUND OR v_game_status <> 'ACTIVE' OR v_pool_wallet_id IS NULL THEN
    RETURN jsonb_build_object(
      'gameCode', 'dragon_tiger',
      'status', 'COMING_SOON',
      'gameStateUnavailable', true,
      'round', NULL
    );
  END IF;

  SELECT gp.wallet_id INTO v_mapped_pool_wallet_id
  FROM platform.game_pools AS gp
  WHERE gp.game_code = 'dragon_tiger';

  SELECT w.wallet_type::text, w.game_code
    INTO v_pool_wallet_type, v_pool_game_code
  FROM wallet.wallets AS w
  WHERE w.id = v_pool_wallet_id
  FOR UPDATE;

  IF v_mapped_pool_wallet_id IS DISTINCT FROM v_pool_wallet_id THEN
    RAISE EXCEPTION 'DRAGON_TIGER_POOL_MAPPING_MISMATCH';
  END IF;
  IF v_pool_wallet_type IS DISTINCT FROM 'GAME_POOL'
     OR v_pool_game_code IS DISTINCT FROM 'dragon_tiger' THEN
    RAISE EXCEPTION 'DRAGON_TIGER_POOL_IDENTITY_MISMATCH';
  END IF;

  SELECT w.id INTO v_escrow_wallet_id
  FROM wallet.wallets AS w
  WHERE w.wallet_type = 'ESCROW'
  ORDER BY w.id
  LIMIT 1
  FOR UPDATE;
  IF v_escrow_wallet_id IS NULL THEN
    RAISE EXCEPTION 'DRAGON_TIGER_ESCROW_WALLET_MISSING';
  END IF;

  SELECT *
    INTO v_round
  FROM dragon_tiger.authoritative_game_rounds
  WHERE game_code = 'dragon_tiger'
  ORDER BY round_number DESC
  LIMIT 1
  FOR UPDATE;
  v_has_round := FOUND;

  -- Close betting, deterministically shuffle a standard 52-card deck, and
  -- persist the two server-selected cards. Aces are low; equal ranks are TIE
  -- regardless of suit. No client input participates in result generation.
  IF v_has_round
     AND v_round.status = 'BETTING'
     AND v_round.betting_closes_at <= clock_timestamp() THEN
    v_seed := v_round.server_seed;
    IF v_seed IS NULL
       OR encode(extensions.digest(v_seed, 'sha256'), 'hex') <> v_round.server_seed_hash THEN
      RAISE EXCEPTION 'DRAGON_TIGER_SERVER_SEED_HASH_MISMATCH';
    END IF;

    FOR v_suit IN SELECT unnest(v_suits) LOOP
      FOR v_rank IN 2..14 LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object(
          'rank', v_rank,
          'suit', v_suit
        ));
      END LOOP;
    END LOOP;

    -- Fisher-Yates shuffle with HMAC-SHA256 values derived from the committed seed.
    FOR v_i IN REVERSE 52..2 LOOP
      v_hmac_hex := encode(extensions.hmac('dragon-tiger:deck:' || (v_i - 1)::text, v_seed, 'sha256'), 'hex');
      v_j := (('x' || substr(v_hmac_hex, 1, 13))::bit(52)::bigint % v_i)::integer;
      v_card_i := v_deck -> (v_i - 1);
      v_card_j := v_deck -> v_j;
      v_deck := jsonb_set(v_deck, ARRAY[(v_i - 1)::text], v_card_j, false);
      v_deck := jsonb_set(v_deck, ARRAY[v_j::text], v_card_i, false);
    END LOOP;

    v_dragon_card := v_deck -> 0;
    v_tiger_card := v_deck -> 1;
    v_dragon_value := CASE WHEN (v_dragon_card->>'rank')::integer = 14 THEN 1 ELSE (v_dragon_card->>'rank')::integer END;
    v_tiger_value := CASE WHEN (v_tiger_card->>'rank')::integer = 14 THEN 1 ELSE (v_tiger_card->>'rank')::integer END;
    v_winner := CASE
      WHEN v_dragon_value > v_tiger_value THEN 'dragon'
      WHEN v_tiger_value > v_dragon_value THEN 'tiger'
      ELSE 'tie'
    END;

    UPDATE dragon_tiger.authoritative_game_rounds
    SET status = 'RUNNING',
        result = jsonb_build_object(
          'dragonCard', v_dragon_card,
          'tigerCard', v_tiger_card,
          'winner', v_winner
        ),
        state = state || jsonb_build_object('revealStartedAt', clock_timestamp())
    WHERE id = v_round.id
    RETURNING * INTO v_round;
  END IF;

  -- Hold the cards for the reveal animation, then settle every pending bet
  -- atomically. This block is idempotent because it only processes PENDING bets
  -- and changes the round to SETTLED in the same transaction.
  IF v_has_round
     AND v_round.status = 'RUNNING'
     AND NULLIF(v_round.state->>'revealStartedAt', '') IS NOT NULL
     AND (v_round.state->>'revealStartedAt')::timestamptz
           <= clock_timestamp() - interval '4500 milliseconds' THEN
    v_seed := v_round.server_seed;
    IF v_seed IS NULL
       OR encode(extensions.digest(v_seed, 'sha256'), 'hex') <> v_round.server_seed_hash THEN
      RAISE EXCEPTION 'DRAGON_TIGER_SERVER_SEED_HASH_MISMATCH';
    END IF;

    v_dragon_card := v_round.result->'dragonCard';
    v_tiger_card := v_round.result->'tigerCard';
    IF jsonb_typeof(v_dragon_card) <> 'object'
       OR jsonb_typeof(v_tiger_card) <> 'object'
       OR v_round.result->>'winner' NOT IN ('dragon', 'tiger', 'tie') THEN
      RAISE EXCEPTION 'DRAGON_TIGER_RESULT_INVALID';
    END IF;

    v_dragon_value := CASE WHEN (v_dragon_card->>'rank')::integer = 14 THEN 1 ELSE (v_dragon_card->>'rank')::integer END;
    v_tiger_value := CASE WHEN (v_tiger_card->>'rank')::integer = 14 THEN 1 ELSE (v_tiger_card->>'rank')::integer END;
    IF (v_dragon_value > v_tiger_value AND v_round.result->>'winner' <> 'dragon')
       OR (v_tiger_value > v_dragon_value AND v_round.result->>'winner' <> 'tiger')
       OR (v_dragon_value = v_tiger_value AND v_round.result->>'winner' <> 'tie') THEN
      RAISE EXCEPTION 'DRAGON_TIGER_RESULT_INTEGRITY_MISMATCH';
    END IF;

    FOR v_bet IN
      SELECT *
      FROM dragon_tiger.authoritative_game_bets
      WHERE round_id = v_round.id
        AND status = 'PENDING'
      ORDER BY id
      FOR UPDATE
    LOOP
      v_type := lower(coalesce(v_bet.selection->>'type', ''));
      IF v_type NOT IN ('dragon', 'tiger', 'tie') THEN
        RAISE EXCEPTION 'INVALID_DRAGON_TIGER_SELECTION';
      END IF;

      v_won := v_type = v_round.result->>'winner';
      v_multiplier := CASE WHEN v_type = 'tie' THEN 9 ELSE 2 END;
      v_expected_liability := v_bet.bet_amount * v_multiplier;
      IF v_bet.reserved_liability IS DISTINCT FROM v_expected_liability THEN
        RAISE EXCEPTION 'DRAGON_TIGER_RESERVED_LIABILITY_MISMATCH';
      END IF;

      v_gross := CASE WHEN v_won THEN v_bet.bet_amount * v_multiplier ELSE 0 END;
      v_profit := CASE WHEN v_won THEN v_gross - v_bet.bet_amount ELSE 0 END;
      v_payout_tx := NULL;
      v_stake_tx := NULL;

      SELECT w.id INTO v_player_wallet_id
      FROM wallet.wallets AS w
      WHERE w.user_id = v_bet.user_id
        AND w.wallet_type = 'PLAYER'
      ORDER BY w.id
      LIMIT 1
      FOR UPDATE;
      IF v_player_wallet_id IS NULL THEN
        RAISE EXCEPTION 'DRAGON_TIGER_PLAYER_WALLET_MISSING';
      END IF;

      IF v_won THEN
        SELECT wallet.wallet_transfer_atomic(
          'DRAGON_TIGER_STAKE_RETURN_' || replace(v_bet.id::text, '-', ''),
          'BET_ESCROW_REFUND'::public.transaction_type_enum,
          v_bet.bet_amount,
          v_escrow_wallet_id,
          v_player_wallet_id,
          jsonb_build_object(
            'gameCode', 'dragon_tiger',
            'roundId', v_round.id,
            'betId', v_bet.id,
            'reason', 'winning stake return'
          )
        ) INTO v_stake_tx;

        IF v_profit > 0 THEN
          SELECT wallet.wallet_transfer_atomic(
            'DRAGON_TIGER_PAYOUT_' || replace(v_bet.id::text, '-', ''),
            'BET_WIN_PAYOUT'::public.transaction_type_enum,
            v_profit,
            v_pool_wallet_id,
            v_player_wallet_id,
            jsonb_build_object(
              'gameCode', 'dragon_tiger',
              'roundId', v_round.id,
              'betId', v_bet.id,
              'winner', v_round.result->>'winner',
              'grossPayout', v_gross::text
            )
          ) INTO v_payout_tx;
        END IF;
      ELSE
        SELECT wallet.wallet_transfer_atomic(
          'DRAGON_TIGER_LOSS_' || replace(v_bet.id::text, '-', ''),
          'BET_LOSS_GAME_POOL'::public.transaction_type_enum,
          v_bet.bet_amount,
          v_escrow_wallet_id,
          v_pool_wallet_id,
          jsonb_build_object(
            'gameCode', 'dragon_tiger',
            'roundId', v_round.id,
            'betId', v_bet.id,
            'winner', v_round.result->>'winner'
          )
        ) INTO v_stake_tx;
      END IF;

      UPDATE dragon_tiger.authoritative_game_bets
      SET status = CASE WHEN v_won THEN 'WON' ELSE 'LOST' END,
          payout_amount = v_gross,
          stake_release_transaction_id = v_stake_tx,
          payout_transaction_id = v_payout_tx,
          settled_at = clock_timestamp()
      WHERE id = v_bet.id;

      UPDATE wallet.wallets
      SET reserved_balance = reserved_balance - v_bet.reserved_liability,
          updated_at = clock_timestamp()
      WHERE id = v_pool_wallet_id
        AND reserved_balance >= v_bet.reserved_liability;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'DRAGON_TIGER_RESERVED_LIABILITY_MISMATCH';
      END IF;
    END LOOP;

    UPDATE dragon_tiger.authoritative_game_rounds
    SET status = 'SETTLED',
        settled_at = clock_timestamp(),
        server_seed = v_seed,
        state = state || jsonb_build_object('settlementComplete', true)
    WHERE id = v_round.id
    RETURNING * INTO v_round;
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

    INSERT INTO dragon_tiger.authoritative_game_rounds (
      game_code, round_number, status, state, server_seed_hash, server_seed,
      opened_at, betting_closes_at
    )
    SELECT
      'dragon_tiger',
      coalesce(max(round_number), 0) + 1,
      'BETTING',
      jsonb_build_object('totalBetsCount', 0, 'totalBetAmount', '0'),
      v_seed_hash,
      v_seed,
      clock_timestamp(),
      clock_timestamp() + interval '12 seconds'
    FROM dragon_tiger.authoritative_game_rounds
    RETURNING * INTO v_round;
    v_has_round := true;
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
    FROM dragon_tiger.authoritative_game_rounds
    WHERE status = 'SETTLED'
    ORDER BY round_number DESC
    LIMIT 25
  ) AS h;

  RETURN jsonb_build_object(
    'gameCode', 'dragon_tiger',
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
$function$


REVOKE ALL ON FUNCTION dragon_tiger.advance_round() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dragon_tiger.advance_round() TO service_role;
COMMENT ON FUNCTION dragon_tiger.advance_round() IS
  'Advances Dragon Tiger rounds with a committed deterministic deck, three markets, and atomic idempotent wallet settlement.';

COMMIT;
