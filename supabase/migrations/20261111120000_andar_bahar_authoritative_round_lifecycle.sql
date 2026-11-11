-- Andar Bahar production-authoritative lifecycle.
-- Reuses existing per-game tables, shared wallet ledger and atomic transfer RPC.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION andar_bahar.validate_bet_selection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_type text;
BEGIN
  IF jsonb_typeof(NEW.selection) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_ANDAR_BAHAR_SELECTION' USING ERRCODE = '22023';
  END IF;
  v_type := lower(coalesce(NEW.selection->>'type', ''));
  IF v_type NOT IN ('andar', 'bahar', 'joker_red', 'joker_black') THEN
    RAISE EXCEPTION 'INVALID_ANDAR_BAHAR_SELECTION' USING ERRCODE = '22023';
  END IF;
  IF NEW.bet_amount <= 0 OR NEW.bet_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_ANDAR_BAHAR_AMOUNT' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_andar_bahar_bet_selection ON andar_bahar.authoritative_game_bets;
CREATE TRIGGER validate_andar_bahar_bet_selection
BEFORE INSERT OR UPDATE OF selection, bet_amount
ON andar_bahar.authoritative_game_bets
FOR EACH ROW EXECUTE FUNCTION andar_bahar.validate_bet_selection();

CREATE OR REPLACE FUNCTION andar_bahar.advance_round()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_game_status text;
  v_pool_wallet_id uuid;
  v_mapped_pool_wallet_id uuid;
  v_pool_type text;
  v_pool_game_code text;
  v_pool_balance bigint;
  v_pool_reserved bigint;
  v_escrow_wallet_id uuid;
  v_player_wallet_id uuid;
  v_round andar_bahar.authoritative_game_rounds%ROWTYPE;
  v_has_round boolean := false;
  v_bet andar_bahar.authoritative_game_bets%ROWTYPE;
  v_seed text;
  v_seed_hash text;
  v_deck jsonb := '[]'::jsonb;
  v_deal_cards jsonb := '[]'::jsonb;
  v_suits text[] := ARRAY['S','H','D','C'];
  v_ranks text[] := ARRAY['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  v_i integer;
  v_j integer;
  v_rank integer;
  v_suit text;
  v_code text;
  v_hmac_hex text;
  v_card_i jsonb;
  v_card_j jsonb;
  v_joker jsonb;
  v_card jsonb;
  v_side text;
  v_winner text;
  v_dealt integer := 0;
  v_type text;
  v_won boolean;
  v_expected_liability bigint;
  v_gross bigint;
  v_profit bigint;
  v_payout_tx uuid;
  v_stake_tx uuid;
  v_history jsonb;
BEGIN
  -- Serialize all lifecycle transitions. Bet placement locks the current round too.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('andar-bahar-round-lifecycle-v1'));

  SELECT g.status, g.pool_wallet_id
    INTO v_game_status, v_pool_wallet_id
  FROM platform.games AS g
  WHERE g.code = 'andar_bahar'
  FOR UPDATE;

  IF NOT FOUND OR v_game_status <> 'ACTIVE' OR v_pool_wallet_id IS NULL THEN
    RETURN jsonb_build_object('gameCode','andar_bahar','status','COMING_SOON',
      'gameStateUnavailable',true,'round',NULL);
  END IF;

  SELECT gp.wallet_id INTO v_mapped_pool_wallet_id
  FROM platform.game_pools AS gp WHERE gp.game_code = 'andar_bahar';

  SELECT w.wallet_type::text, w.game_code, w.balance, w.reserved_balance
    INTO v_pool_type, v_pool_game_code, v_pool_balance, v_pool_reserved
  FROM wallet.wallets AS w WHERE w.id = v_pool_wallet_id FOR UPDATE;

  IF v_mapped_pool_wallet_id IS DISTINCT FROM v_pool_wallet_id THEN
    RAISE EXCEPTION 'ANDAR_BAHAR_POOL_MAPPING_MISMATCH';
  END IF;
  IF v_pool_type IS DISTINCT FROM 'GAME_POOL' OR v_pool_game_code IS DISTINCT FROM 'andar_bahar' THEN
    RAISE EXCEPTION 'ANDAR_BAHAR_POOL_IDENTITY_MISMATCH';
  END IF;
  IF v_pool_balance < v_pool_reserved OR v_pool_balance - v_pool_reserved <= 0 THEN
    RAISE EXCEPTION 'ANDAR_BAHAR_POOL_LIQUIDITY_INSUFFICIENT';
  END IF;

  SELECT w.id INTO v_escrow_wallet_id
  FROM wallet.wallets AS w
  WHERE w.wallet_type = 'ESCROW'
  ORDER BY w.id LIMIT 1 FOR UPDATE;
  IF v_escrow_wallet_id IS NULL THEN RAISE EXCEPTION 'ANDAR_BAHAR_ESCROW_WALLET_MISSING'; END IF;

  SELECT * INTO v_round
  FROM andar_bahar.authoritative_game_rounds
  WHERE game_code = 'andar_bahar'
  ORDER BY round_number DESC LIMIT 1
  FOR UPDATE;
  v_has_round := FOUND;

  -- Close betting and create the committed, server-only shuffled deck.
  IF v_has_round AND v_round.status = 'BETTING'
     AND v_round.betting_closes_at <= clock_timestamp() THEN
    v_seed := v_round.server_seed;
    IF v_seed IS NULL OR encode(extensions.digest(v_seed,'sha256'),'hex') <> v_round.server_seed_hash THEN
      RAISE EXCEPTION 'ANDAR_BAHAR_SERVER_SEED_HASH_MISMATCH';
    END IF;

    FOR v_suit IN SELECT unnest(v_suits) LOOP
      FOR v_rank IN 2..14 LOOP
        v_code := v_ranks[v_rank - 1] || v_suit;
        v_deck := v_deck || jsonb_build_array(jsonb_build_object(
          'rank',v_rank,'suit',v_suit,'code',v_code,'deckIndex',0
        ));
      END LOOP;
    END LOOP;

    -- Deterministic Fisher-Yates shuffle driven by HMAC-SHA256 and a 256-bit
    -- server seed generated with pgcrypto. The client never supplies the seed.
    FOR v_i IN REVERSE 52..2 LOOP
      v_hmac_hex := encode(extensions.hmac('deck:' || (v_i - 1)::text,v_seed,'sha256'),'hex');
      v_j := (('x' || substr(v_hmac_hex,1,13))::bit(52)::bigint % v_i)::integer;
      v_card_i := v_deck -> (v_i - 1);
      v_card_j := v_deck -> v_j;
      v_deck := jsonb_set(v_deck,ARRAY[(v_i - 1)::text],v_card_j,false);
      v_deck := jsonb_set(v_deck,ARRAY[v_j::text],v_card_i,false);
    END LOOP;

    v_joker := v_deck -> 0;
    v_winner := NULL;
    v_deal_cards := '[]'::jsonb;
    v_dealt := 0;

    -- Preserve the existing game contract: Bahar receives the first card,
    -- then Andar, alternating until the first card matching the Joker rank.
    FOR v_i IN 1..51 LOOP
      v_card := v_deck -> v_i;
      v_side := CASE WHEN v_i % 2 = 1 THEN 'bahar' ELSE 'andar' END;
      v_deal_cards := v_deal_cards || jsonb_build_array(jsonb_build_object('side',v_side,'card',v_card));
      v_dealt := v_dealt + 1;
      IF (v_card->>'rank')::integer = (v_joker->>'rank')::integer THEN
        v_winner := v_side;
        EXIT;
      END IF;
    END LOOP;

    IF v_winner IS NULL OR v_dealt < 1 OR v_dealt > 51 THEN
      RAISE EXCEPTION 'ANDAR_BAHAR_DECK_RESULT_INVALID';
    END IF;

    UPDATE andar_bahar.authoritative_game_rounds
    SET status = 'RUNNING',
        result = jsonb_build_object(
          'jokerCard',v_joker,'dealCards',v_deal_cards,'winner',v_winner,
          'totalCardsDealt',v_dealt,'firstSide','bahar'
        ),
        state = state || jsonb_build_object('dealStartedAt',clock_timestamp())
    WHERE id = v_round.id
    RETURNING * INTO v_round;
  END IF;

  -- Keep the result private until the persisted dealing animation has elapsed,
  -- then settle all bets atomically in this same transaction.
  IF v_has_round AND v_round.status = 'RUNNING'
     AND NULLIF(v_round.state->>'dealStartedAt','') IS NOT NULL
     AND (v_round.state->>'dealStartedAt')::timestamptz
           <= clock_timestamp() - interval '4500 milliseconds' THEN
    v_seed := v_round.server_seed;
    IF v_seed IS NULL OR encode(extensions.digest(v_seed,'sha256'),'hex') <> v_round.server_seed_hash THEN
      RAISE EXCEPTION 'ANDAR_BAHAR_SERVER_SEED_HASH_MISMATCH';
    END IF;
    IF v_round.result IS NULL OR v_round.result->>'winner' NOT IN ('andar','bahar')
       OR jsonb_typeof(v_round.result->'dealCards') <> 'array' THEN
      RAISE EXCEPTION 'ANDAR_BAHAR_RESULT_INVALID';
    END IF;

    FOR v_bet IN
      SELECT * FROM andar_bahar.authoritative_game_bets
      WHERE round_id = v_round.id AND status = 'PENDING'
      ORDER BY id FOR UPDATE
    LOOP
      v_type := lower(coalesce(v_bet.selection->>'type',''));
      IF v_type NOT IN ('andar','bahar') THEN RAISE EXCEPTION 'ANDAR_BAHAR_BET_SELECTION_INVALID'; END IF;
      v_expected_liability := v_bet.bet_amount * 2;
      IF v_bet.reserved_liability IS DISTINCT FROM v_expected_liability THEN
        RAISE EXCEPTION 'ANDAR_BAHAR_RESERVED_LIABILITY_MISMATCH';
      END IF;
      v_won := CASE
        WHEN v_type = 'andar' THEN v_round.result->>'winner' = 'andar'
        WHEN v_type = 'bahar' THEN v_round.result->>'winner' = 'bahar'
        WHEN v_type = 'joker_red' THEN v_round.result->'jokerCard'->>'suit' IN ('H','D')
        WHEN v_type = 'joker_black' THEN v_round.result->'jokerCard'->>'suit' IN ('S','C')
        ELSE false
      END;
      v_gross := CASE
        WHEN NOT v_won THEN 0
        WHEN v_type = 'andar' THEN v_bet.bet_amount * 2
        WHEN v_type = 'bahar' THEN floor(v_bet.bet_amount::numeric * 190 / 100)::bigint
        WHEN v_type IN ('joker_red','joker_black') THEN floor(v_bet.bet_amount::numeric * 195 / 100)::bigint
        ELSE 0
      END;
      v_profit := CASE WHEN v_won THEN v_gross - v_bet.bet_amount ELSE 0 END;
      v_payout_tx := NULL;
      v_stake_tx := NULL;

      SELECT w.id INTO v_player_wallet_id
      FROM wallet.wallets AS w
      WHERE w.user_id = v_bet.user_id AND w.wallet_type = 'PLAYER'
      ORDER BY w.id LIMIT 1 FOR UPDATE;
      IF v_player_wallet_id IS NULL THEN RAISE EXCEPTION 'ANDAR_BAHAR_PLAYER_WALLET_MISSING'; END IF;

      IF v_won THEN
        SELECT wallet.wallet_transfer_atomic(
          'ANDAR_BAHAR_STAKE_RETURN_' || replace(v_bet.id::text,'-',''),
          'BET_ESCROW_REFUND'::public.transaction_type_enum,
          v_bet.bet_amount,v_escrow_wallet_id,v_player_wallet_id,
          jsonb_build_object('gameCode','andar_bahar','roundId',v_round.id,'betId',v_bet.id,'reason','winning stake return')
        ) INTO v_stake_tx;
        IF v_profit > 0 THEN
          SELECT wallet.wallet_transfer_atomic(
            'ANDAR_BAHAR_PAYOUT_' || replace(v_bet.id::text,'-',''),
            'BET_WIN_PAYOUT'::public.transaction_type_enum,
            v_profit,v_pool_wallet_id,v_player_wallet_id,
            jsonb_build_object('gameCode','andar_bahar','roundId',v_round.id,'betId',v_bet.id,
              'winningSide',v_round.result->>'winner','grossPayout',v_gross::text)
          ) INTO v_payout_tx;
        END IF;
      ELSE
        SELECT wallet.wallet_transfer_atomic(
          'ANDAR_BAHAR_LOSS_' || replace(v_bet.id::text,'-',''),
          'BET_LOSS_GAME_POOL'::public.transaction_type_enum,
          v_bet.bet_amount,v_escrow_wallet_id,v_pool_wallet_id,
          jsonb_build_object('gameCode','andar_bahar','roundId',v_round.id,'betId',v_bet.id,
            'winningSide',v_round.result->>'winner')
        ) INTO v_stake_tx;
      END IF;

      UPDATE andar_bahar.authoritative_game_bets
      SET status = CASE WHEN v_won THEN 'WON' ELSE 'LOST' END,
          payout_amount = v_gross,
          stake_release_transaction_id = v_stake_tx,
          payout_transaction_id = v_payout_tx,
          settled_at = clock_timestamp()
      WHERE id = v_bet.id;

      UPDATE wallet.wallets
      SET reserved_balance = reserved_balance - v_bet.reserved_liability,
          updated_at = clock_timestamp()
      WHERE id = v_pool_wallet_id AND reserved_balance >= v_bet.reserved_liability;
      IF NOT FOUND THEN RAISE EXCEPTION 'ANDAR_BAHAR_RESERVED_LIABILITY_MISMATCH'; END IF;
    END LOOP;

    UPDATE andar_bahar.authoritative_game_rounds
    SET status = 'SETTLED', settled_at = clock_timestamp(), server_seed = v_seed,
        state = state || jsonb_build_object('settlementComplete',true)
    WHERE id = v_round.id
    RETURNING * INTO v_round;
  END IF;

  -- Create the next betting round after the result display window.
  IF NOT v_has_round OR
     (v_round.status IN ('SETTLED','CANCELLED') AND
      (v_round.settled_at IS NULL OR v_round.settled_at <= clock_timestamp() - interval '5 seconds')) THEN
    v_seed := encode(extensions.gen_random_bytes(32),'hex');
    v_seed_hash := encode(extensions.digest(v_seed,'sha256'),'hex');
    INSERT INTO andar_bahar.authoritative_game_rounds
      (game_code,round_number,status,state,server_seed_hash,server_seed,opened_at,betting_closes_at)
    SELECT 'andar_bahar',coalesce(max(round_number),0)+1,'BETTING',
      jsonb_build_object('totalBetsCount',0,'totalBetAmount','0'),
      v_seed_hash,v_seed,clock_timestamp(),clock_timestamp()+interval '15 seconds'
    FROM andar_bahar.authoritative_game_rounds
    RETURNING * INTO v_round;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'roundNumber',h.round_number,'result',h.result,'timestamp',h.settled_at
  ) ORDER BY h.round_number DESC),'[]'::jsonb)
  INTO v_history
  FROM (SELECT round_number,result,settled_at FROM andar_bahar.authoritative_game_rounds
        WHERE status='SETTLED' ORDER BY round_number DESC LIMIT 25) h;

  RETURN jsonb_build_object(
    'gameCode','andar_bahar','status','ACTIVE',
    'round',jsonb_build_object(
      'id',v_round.id,'roundNumber',v_round.round_number,'status',v_round.status,
      'openedAt',v_round.opened_at,'bettingEndsAt',v_round.betting_closes_at,
      'result',CASE WHEN v_round.status='SETTLED' THEN v_round.result ELSE NULL END,
      'serverSeedHash',v_round.server_seed_hash,
      'revealedServerSeed',CASE WHEN v_round.status='SETTLED' THEN v_round.server_seed ELSE NULL END
    ),
    'history',v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION andar_bahar.advance_round() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION andar_bahar.advance_round() TO service_role;
REVOKE ALL ON FUNCTION andar_bahar.validate_bet_selection() FROM PUBLIC, anon, authenticated;

COMMIT;
