-- Atomic REST/RPC replacement for the existing authoritative-games bet transaction.
-- The Edge Function passes a validated batch; this function rechecks every financial
-- invariant under row locks and only permits service_role to invoke it.
CREATE OR REPLACE FUNCTION platform.place_authoritative_game_bets_atomic(
  p_game_code text,
  p_user_id uuid,
  p_bets jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_schema text;
  v_game record;
  v_round record;
  v_player record;
  v_escrow record;
  v_pool record;
  v_item jsonb;
  v_selection jsonb;
  v_amount bigint;
  v_multiplier bigint;
  v_liability bigint;
  v_total_liability bigint := 0;
  v_total_bet bigint := 0;
  v_key text;
  v_existing_count integer := 0;
  v_expected_count integer;
  v_existing jsonb;
  v_placed jsonb := '[]'::jsonb;
  v_bet_id uuid;
  v_tx_id uuid;
  v_type text;
  v_i integer := 0;
BEGIN
  IF p_game_code NOT IN ('roulette','dice','dragon_tiger','andar_bahar') THEN
    RAISE EXCEPTION 'UNKNOWN_GAME' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_bets IS NULL OR jsonb_typeof(p_bets) <> 'array'
     OR jsonb_array_length(p_bets) < 1 OR jsonb_array_length(p_bets) > 20 THEN
    RAISE EXCEPTION 'INVALID_BET_COUNT' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8
     OR length(p_idempotency_key) > 110 OR p_idempotency_key !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;

  v_schema := p_game_code;
  v_expected_count := jsonb_array_length(p_bets);

  IF NOT EXISTS (
    SELECT 1 FROM platform.users u
    JOIN platform.role_assignments ra ON ra.user_id = u.id
    WHERE u.id = p_user_id AND u.is_active = true AND ra.role = 'PLAYER'
  ) THEN
    RAISE EXCEPTION 'PLAYER_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  -- Replay only if the complete request exists and every item matches exactly.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_bets)
  LOOP
    v_key := CASE WHEN v_expected_count = 1 THEN p_idempotency_key
                  ELSE p_idempotency_key || '_' || v_i::text END;
    v_selection := COALESCE(v_item->'selection', v_item);
    BEGIN
      v_amount := (v_item->>'amount')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_BET_AMOUNT' USING ERRCODE = '22023';
    END;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_BET_AMOUNT' USING ERRCODE = '22023'; END IF;
    EXECUTE format(
      'SELECT id,user_id,round_id,bet_amount,selection,idempotency_key FROM %I.authoritative_game_bets WHERE idempotency_key=$1',
      v_schema
    ) INTO v_existing USING v_key;
    IF FOUND THEN
      v_existing_count := v_existing_count + 1;
      IF v_existing.user_id <> p_user_id OR v_existing.bet_amount <> v_amount
         OR v_existing.selection <> v_selection THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '23505';
      END IF;
      v_placed := v_placed || jsonb_build_array(jsonb_build_object(
        'id',v_existing.id,'status','PENDING','amount',v_amount::text,
        'selection',v_selection,'replay',true
      ));
    END IF;
    v_i := v_i + 1;
  END LOOP;

  IF v_existing_count > 0 THEN
    IF v_existing_count <> v_expected_count THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'success',true,'replay',true,'betCount',v_expected_count,
      'placedBets',v_placed
    );
  END IF;

  SELECT g.id,g.pool_wallet_id,g.min_bet,g.max_bet
  INTO v_game
  FROM platform.games g
  WHERE g.code = p_game_code AND g.status = 'ACTIVE'
  LIMIT 1;
  IF NOT FOUND OR v_game.pool_wallet_id IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_CONFIGURED' USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format(
    'SELECT id,round_number,status,betting_closes_at FROM %I.authoritative_game_rounds WHERE game_code=$1 AND status=''BETTING'' AND betting_closes_at>now() ORDER BY round_number DESC LIMIT 1 FOR UPDATE',
    v_schema
  ) INTO v_round USING p_game_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'BETTING_CLOSED' USING ERRCODE = 'P0001'; END IF;

  SELECT id,balance,reserved_balance INTO v_pool
  FROM wallet.wallets WHERE id = v_game.pool_wallet_id FOR UPDATE;
  SELECT id,balance INTO v_player
  FROM wallet.wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER' LIMIT 1 FOR UPDATE;
  SELECT id INTO v_escrow
  FROM wallet.wallets WHERE wallet_type = 'ESCROW' ORDER BY id LIMIT 1 FOR UPDATE;
  IF v_pool.id IS NULL OR v_player.id IS NULL OR v_escrow.id IS NULL THEN
    RAISE EXCEPTION 'GAME_WALLETS_NOT_CONFIGURED' USING ERRCODE = 'P0001';
  END IF;

  v_i := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_bets)
  LOOP
    v_key := CASE WHEN v_expected_count = 1 THEN p_idempotency_key
                  ELSE p_idempotency_key || '_' || v_i::text END;
    v_selection := COALESCE(v_item->'selection', v_item);
    v_amount := (v_item->>'amount')::bigint;
    IF v_amount < v_game.min_bet OR v_amount > v_game.max_bet THEN
      RAISE EXCEPTION 'BET_OUT_OF_RANGE' USING ERRCODE = '22023';
    END IF;

    v_type := lower(COALESCE(v_selection->>'type',''));
    IF p_game_code = 'roulette' THEN
      IF v_type IN ('straight','number') THEN v_multiplier := 36;
      ELSIF v_type = 'split' THEN v_multiplier := 18;
      ELSIF v_type = 'street' THEN v_multiplier := 12;
      ELSIF v_type = 'corner' THEN v_multiplier := 9;
      ELSIF v_type = 'line' THEN v_multiplier := 6;
      ELSIF v_type IN ('dozen','column') OR v_type LIKE 'dozen%' OR v_type LIKE 'col%' THEN v_multiplier := 3;
      ELSIF v_type = 'green' THEN v_multiplier := 36;
      ELSE v_multiplier := 2;
      END IF;
    ELSIF p_game_code = 'dice' AND (v_type = 'number' OR v_type ~ '^[0-9]+$') THEN
      v_multiplier := 10;
    ELSIF p_game_code = 'dragon_tiger' AND v_type = 'suited_tie' THEN
      v_multiplier := 51;
    ELSIF p_game_code = 'dragon_tiger' AND v_type = 'tie' THEN
      v_multiplier := 9;
    ELSE
      v_multiplier := 2;
    END IF;

    IF v_amount > 9223372036854775807::bigint / v_multiplier THEN
      RAISE EXCEPTION 'BET_OUT_OF_RANGE' USING ERRCODE = '22003';
    END IF;
    v_liability := v_amount * v_multiplier;
    v_total_liability := v_total_liability + v_liability;
    v_total_bet := v_total_bet + v_amount;
    v_i := v_i + 1;
  END LOOP;

  IF v_pool.balance - v_pool.reserved_balance < v_total_liability THEN
    RAISE EXCEPTION 'GAME_POOL_INSUFFICIENT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE wallet.wallets
  SET reserved_balance = reserved_balance + v_total_liability, updated_at = now()
  WHERE id = v_pool.id;

  v_i := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_bets)
  LOOP
    v_key := CASE WHEN v_expected_count = 1 THEN p_idempotency_key
                  ELSE p_idempotency_key || '_' || v_i::text END;
    v_selection := COALESCE(v_item->'selection', v_item);
    v_amount := (v_item->>'amount')::bigint;
    v_type := lower(COALESCE(v_selection->>'type',''));
    IF p_game_code = 'roulette' THEN
      IF v_type IN ('straight','number') THEN v_multiplier := 36;
      ELSIF v_type = 'split' THEN v_multiplier := 18;
      ELSIF v_type = 'street' THEN v_multiplier := 12;
      ELSIF v_type = 'corner' THEN v_multiplier := 9;
      ELSIF v_type = 'line' THEN v_multiplier := 6;
      ELSIF v_type IN ('dozen','column') OR v_type LIKE 'dozen%' OR v_type LIKE 'col%' THEN v_multiplier := 3;
      ELSIF v_type = 'green' THEN v_multiplier := 36;
      ELSE v_multiplier := 2;
      END IF;
    ELSIF p_game_code = 'dice' AND (v_type = 'number' OR v_type ~ '^[0-9]+$') THEN v_multiplier := 10;
    ELSIF p_game_code = 'dragon_tiger' AND v_type = 'suited_tie' THEN v_multiplier := 51;
    ELSIF p_game_code = 'dragon_tiger' AND v_type = 'tie' THEN v_multiplier := 9;
    ELSE v_multiplier := 2;
    END IF;
    v_liability := v_amount * v_multiplier;

    EXECUTE format(
      'INSERT INTO %I.authoritative_game_bets(round_id,user_id,bet_amount,selection,idempotency_key,reserved_liability) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      v_schema
    ) INTO v_bet_id USING v_round.id,p_user_id,v_amount,v_selection,v_key,v_liability;

    SELECT wallet.wallet_transfer_atomic(
      'AGAME_BET_' || v_key,
      'BET_ESCROW_LOCK'::public.transaction_type_enum,
      v_amount,
      v_player.id,
      v_escrow.id,
      jsonb_build_object('gameCode',p_game_code,'roundId',v_round.id,'betId',v_bet_id)
    ) INTO v_tx_id;

    EXECUTE format(
      'UPDATE %I.authoritative_game_bets SET escrow_transaction_id=$1 WHERE id=$2',
      v_schema
    ) USING v_tx_id,v_bet_id;

    v_placed := v_placed || jsonb_build_array(jsonb_build_object(
      'id',v_bet_id,'status','PENDING','amount',v_amount::text,
      'selection',v_selection,'replay',false
    ));
    v_i := v_i + 1;
  END LOOP;

  EXECUTE format(
    'UPDATE %I.authoritative_game_rounds SET state=jsonb_set(jsonb_set(state,''{totalBetsCount}'',to_jsonb((SELECT count(*) FROM %I.authoritative_game_bets WHERE round_id=$1)::integer),true),''{totalBetAmount}'',to_jsonb((SELECT COALESCE(sum(bet_amount),0)::text FROM %I.authoritative_game_bets WHERE round_id=$1)),true) WHERE id=$1',
    v_schema,v_schema,v_schema
  ) USING v_round.id;

  RETURN jsonb_build_object(
    'success',true,'replay',false,'roundId',v_round.id,
    'betCount',v_expected_count,'totalBet',v_total_bet::text,'placedBets',v_placed
  );
END;
$function$;

REVOKE ALL ON FUNCTION platform.place_authoritative_game_bets_atomic(text,uuid,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.place_authoritative_game_bets_atomic(text,uuid,jsonb,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.place_authoritative_game_bets_atomic(text,uuid,jsonb,text) TO service_role;


-- Resolve token requests with hierarchy validation and any transfer in one transaction.
CREATE OR REPLACE FUNCTION platform.resolve_token_request_atomic(
  p_request_id uuid,
  p_actor_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_request record;
  v_actor record;
  v_requester record;
  v_source uuid;
  v_target uuid;
  v_tx_type public.transaction_type_enum;
  v_tx_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_actor_id IS NULL OR p_action NOT IN ('APPROVE','REJECT') THEN
    RAISE EXCEPTION 'INVALID_REQUEST_ACTION' USING ERRCODE = '22023';
  END IF;
  SELECT u.id,u.parent_id,ra.role
  INTO v_actor
  FROM platform.users u
  JOIN platform.role_assignments ra ON ra.user_id=u.id
  WHERE u.id=p_actor_id AND u.is_active=true
  FOR UPDATE OF u,ra;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTOR_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  IF v_actor.role = 'PLAYER' THEN RAISE EXCEPTION 'PLAYER_CANNOT_RESOLVE_REQUESTS' USING ERRCODE = '42501'; END IF;

  SELECT id,requester_id,approver_id,amount,status
  INTO v_request
  FROM platform.token_requests
  WHERE id=p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_request.approver_id <> p_actor_id THEN RAISE EXCEPTION 'NOT_ASSIGNED_APPROVER' USING ERRCODE = '42501'; END IF;
  IF v_request.status <> 'PENDING' THEN RAISE EXCEPTION 'REQUEST_ALREADY_RESOLVED' USING ERRCODE = '23505'; END IF;

  SELECT u.id,u.parent_id,ra.role
  INTO v_requester
  FROM platform.users u
  JOIN platform.role_assignments ra ON ra.user_id=u.id
  WHERE u.id=v_request.requester_id AND u.is_active=true;
  IF NOT FOUND OR v_requester.parent_id <> p_actor_id THEN
    RAISE EXCEPTION 'ROLE_HIERARCHY_VIOLATION' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (v_actor.role='OWNER' AND v_requester.role='SUPER_ADMIN') OR
    (v_actor.role='SUPER_ADMIN' AND v_requester.role='ADMIN') OR
    (v_actor.role='ADMIN' AND v_requester.role='PLAYER')
  ) THEN RAISE EXCEPTION 'ROLE_HIERARCHY_VIOLATION' USING ERRCODE = '42501'; END IF;

  IF p_action='APPROVE' THEN
    IF v_actor.role='OWNER' THEN
      SELECT id INTO v_source FROM wallet.wallets WHERE wallet_type='TREASURY' LIMIT 1 FOR UPDATE;
      v_tx_type := 'TREASURY_TO_ROLE';
    ELSE
      SELECT id INTO v_source FROM wallet.wallets WHERE user_id=p_actor_id LIMIT 1 FOR UPDATE;
      v_tx_type := CASE WHEN v_actor.role='SUPER_ADMIN' THEN 'ROLE_TO_ROLE'::public.transaction_type_enum ELSE 'ROLE_TO_PLAYER'::public.transaction_type_enum END;
    END IF;
    SELECT id INTO v_target FROM wallet.wallets WHERE user_id=v_request.requester_id LIMIT 1 FOR UPDATE;
    IF v_source IS NULL OR v_target IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
    SELECT wallet.wallet_transfer_atomic(
      'TOKEN_REQUEST_' || replace(p_request_id::text,'-',''),
      v_tx_type,v_request.amount,v_source,v_target,
      jsonb_build_object('requestId',p_request_id,'approvedBy',p_actor_id)
    ) INTO v_tx_id;
    UPDATE wallet.wallet_transactions SET token_request_id=p_request_id WHERE id=v_tx_id;
    UPDATE platform.token_requests SET status='APPROVED',decision_note=left(p_note,500),resolved_at=now() WHERE id=p_request_id;
    INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details)
    VALUES(p_actor_id,'TOKEN_REQUEST_APPROVED','TOKEN_REQUEST',p_request_id::text,jsonb_build_object('amount',v_request.amount::text,'transactionId',v_tx_id));
    RETURN jsonb_build_object('message','TOKEN_REQUEST_APPROVED','requestId',p_request_id,'transactionId',v_tx_id,'amount',v_request.amount::text);
  END IF;

  UPDATE platform.token_requests SET status='REJECTED',decision_note=left(p_note,500),resolved_at=now() WHERE id=p_request_id;
  INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details)
  VALUES(p_actor_id,'TOKEN_REQUEST_REJECTED','TOKEN_REQUEST',p_request_id::text,jsonb_build_object('amount',v_request.amount::text));
  RETURN jsonb_build_object('requestId',p_request_id,'status','REJECTED');
END;
$function$;

REVOKE ALL ON FUNCTION platform.resolve_token_request_atomic(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.resolve_token_request_atomic(uuid,uuid,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.resolve_token_request_atomic(uuid,uuid,text,text) TO service_role;
