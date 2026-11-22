-- Durable, server-owned Roulette lifecycle. Does not activate Roulette or fund its pool.
CREATE OR REPLACE FUNCTION roulette.advance_round()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_game record;
  v_round roulette.authoritative_game_rounds%ROWTYPE;
  v_bet roulette.authoritative_game_bets%ROWTYPE;
  v_seed text;
  v_hash text;
  v_number integer;
  v_color text;
  v_type text;
  v_numbers jsonb;
  v_multiplier bigint;
  v_won boolean;
  v_payout bigint;
  v_liability bigint;
  v_total_liability bigint := 0;
  v_pool_id uuid;
  v_player_wallet_id uuid;
  v_tx uuid;
  v_history jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('roulette-round-lifecycle-v1'));

  SELECT id,status,pool_wallet_id,min_bet,max_bet
    INTO v_game
    FROM platform.games WHERE code='roulette' FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'ACTIVE' OR v_game.pool_wallet_id IS NULL THEN
    RETURN jsonb_build_object('status','COMING_SOON','gameStateUnavailable',true);
  END IF;
  v_pool_id := v_game.pool_wallet_id;

  SELECT * INTO v_round
    FROM roulette.authoritative_game_rounds
    WHERE game_code='roulette' AND status IN ('BETTING','RUNNING','RESULT')
    ORDER BY round_number DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND v_round.status='BETTING' AND v_round.betting_closes_at <= now() THEN
    -- The winning pocket is generated server-side only after betting closes.
    v_seed := v_round.server_seed;
    IF v_seed IS NULL THEN RAISE EXCEPTION 'ROULETTE_SEED_MISSING'; END IF;
    v_hash := encode(digest(v_seed, 'sha256'), 'hex');
    IF v_hash <> v_round.server_seed_hash THEN RAISE EXCEPTION 'ROULETTE_SEED_HASH_MISMATCH'; END IF;
    v_number := mod(get_byte(digest(v_seed || ':' || v_round.id::text, 'sha256'),0)::integer * 16777216
                  + get_byte(digest(v_seed || ':' || v_round.id::text, 'sha256'),1)::integer * 65536
                  + get_byte(digest(v_seed || ':' || v_round.id::text, 'sha256'),2)::integer * 256
                  + get_byte(digest(v_seed || ':' || v_round.id::text, 'sha256'),3)::integer, 37);
    v_color := CASE WHEN v_number=0 THEN 'green'
                    WHEN v_number IN (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36) THEN 'red'
                    ELSE 'black' END;

    UPDATE roulette.authoritative_game_rounds
      SET status='RUNNING', result=jsonb_build_object('number',v_number,'color',v_color),
          state=state || jsonb_build_object('spinStartedAt',now()), server_seed_hash=v_hash
      WHERE id=v_round.id;

    FOR v_bet IN SELECT * FROM roulette.authoritative_game_bets
      WHERE round_id=v_round.id AND status='PENDING' ORDER BY id FOR UPDATE
    LOOP
      v_type := lower(coalesce(v_bet.selection->>'type',''));
      v_numbers := coalesce(v_bet.selection->'numbers','[]'::jsonb);
      v_multiplier := CASE
        WHEN v_type IN ('straight','number') THEN 36
        WHEN v_type='split' THEN 18
        WHEN v_type='street' THEN 12
        WHEN v_type='corner' THEN 9
        WHEN v_type='line' THEN 6
        WHEN v_type LIKE 'dozen%' OR v_type LIKE 'col%' THEN 3
        ELSE 2 END;

      v_won := CASE
        WHEN v_number=0 THEN (v_type IN ('straight','number') AND v_numbers @> '[0]'::jsonb)
        WHEN v_type IN ('straight','number','split','street','corner','line') THEN v_numbers @> to_jsonb(ARRAY[v_number])
        WHEN v_type='red' THEN v_color='red'
        WHEN v_type='black' THEN v_color='black'
        WHEN v_type='even' THEN v_number % 2=0
        WHEN v_type='odd' THEN v_number % 2=1
        WHEN v_type='low' THEN v_number BETWEEN 1 AND 18
        WHEN v_type='high' THEN v_number BETWEEN 19 AND 36
        WHEN v_type='dozen1' THEN v_number BETWEEN 1 AND 12
        WHEN v_type='dozen2' THEN v_number BETWEEN 13 AND 24
        WHEN v_type='dozen3' THEN v_number BETWEEN 25 AND 36
        WHEN v_type='col1' THEN v_number % 3=1
        WHEN v_type='col2' THEN v_number % 3=2
        WHEN v_type='col3' THEN v_number % 3=0
        ELSE false END;
      v_payout := CASE WHEN v_won THEN v_bet.bet_amount * v_multiplier ELSE 0 END;
      v_total_liability := v_total_liability + v_bet.reserved_liability;

      IF v_payout > 0 THEN
        SELECT id INTO v_player_wallet_id FROM wallet.wallets
          WHERE user_id=v_bet.user_id AND wallet_type='PLAYER' ORDER BY id LIMIT 1 FOR UPDATE;
        IF v_player_wallet_id IS NULL THEN RAISE EXCEPTION 'ROULETTE_PLAYER_WALLET_MISSING'; END IF;
        SELECT wallet.wallet_transfer_atomic(
          'ROULETTE_PAYOUT_' || replace(v_bet.id::text,'-',''),
          'BET_WIN_PAYOUT'::public.transaction_type_enum,
          v_payout, v_pool_id, v_player_wallet_id,
          jsonb_build_object('gameCode','roulette','roundId',v_round.id,'betId',v_bet.id,'winningNumber',v_number)
        ) INTO v_tx;
      ELSE
        v_tx := NULL;
      END IF;

      UPDATE roulette.authoritative_game_bets
        SET status=CASE WHEN v_won THEN 'WON' ELSE 'LOST' END,
            payout_amount=v_payout, payout_transaction_id=v_tx, settled_at=now()
        WHERE id=v_bet.id;
      -- Release exactly this bet's liability after any payout is booked.
      UPDATE wallet.wallets SET reserved_balance=reserved_balance-v_bet.reserved_liability, updated_at=now()
        WHERE id=v_pool_id AND reserved_balance >= v_bet.reserved_liability;
      IF NOT FOUND THEN RAISE EXCEPTION 'ROULETTE_RESERVED_LIABILITY_MISMATCH'; END IF;
    END LOOP;

    UPDATE roulette.authoritative_game_rounds
      SET status='SETTLED', settled_at=now(), server_seed=v_seed,
          result=jsonb_build_object('number',v_number,'color',v_color),
          state=state || jsonb_build_object('settlementComplete',true)
      WHERE id=v_round.id;
    SELECT * INTO v_round FROM roulette.authoritative_game_rounds WHERE id=v_round.id;
  END IF;

  -- Keep the settled result visible for three seconds, then persist a new betting round.
  IF NOT FOUND OR (v_round.status='SETTLED' AND v_round.settled_at < now()-interval '3 seconds') THEN
    v_seed := encode(gen_random_bytes(32),'hex');
    v_hash := encode(digest(v_seed,'sha256'),'hex');
    INSERT INTO roulette.authoritative_game_rounds
      (game_code,round_number,status,state,server_seed_hash,server_seed,opened_at,betting_closes_at)
    SELECT 'roulette',coalesce(max(round_number),0)+1,'BETTING',
      jsonb_build_object('totalBetsCount',0,'totalBetAmount','0'),
      v_hash,v_seed,now(),now()+interval '15 seconds'
    FROM roulette.authoritative_game_rounds
    RETURNING * INTO v_round;
  END IF;

  RETURN jsonb_build_object(
    'gameCode','roulette','status','ACTIVE',
    'round',jsonb_build_object('id',v_round.id,'roundNumber',v_round.round_number,
      'status',v_round.status,'openedAt',v_round.opened_at,
      'bettingEndsAt',v_round.betting_closes_at,
      'result',CASE WHEN v_round.status IN ('RUNNING','RESULT','SETTLED') THEN v_round.result ELSE NULL END,
      'serverSeedHash',v_round.server_seed_hash,
      'revealedServerSeed',CASE WHEN v_round.status='SETTLED' THEN v_round.server_seed ELSE NULL END),
    'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('roundNumber',h.round_number,'result',h.result,'timestamp',h.settled_at) ORDER BY h.round_number DESC),'[]'::jsonb)
      FROM (SELECT round_number,result,settled_at FROM roulette.authoritative_game_rounds WHERE status='SETTLED' ORDER BY round_number DESC LIMIT 25) h)
  );
END;
$$;

REVOKE ALL ON FUNCTION roulette.advance_round() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION roulette.advance_round() TO service_role;

COMMENT ON FUNCTION roulette.advance_round() IS
'Advances durable Roulette rounds and settles all bets atomically; call only from the authenticated server API using service_role.';
