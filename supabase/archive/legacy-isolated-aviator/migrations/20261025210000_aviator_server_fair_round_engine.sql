-- Server-owned provably-fair round generation and authoritative multiplier decisions.
-- No client-supplied seed or crash point is accepted. The seed is committed by
-- SHA-256 before play and revealed only after the round crashes.

BEGIN;

DROP FUNCTION IF EXISTS aviator.create_waiting_round(bigint, text, text, numeric);
DROP FUNCTION IF EXISTS aviator.cashout_bet_intent(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION aviator.cashout_bet_intent(
  p_bet_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator, extensions
AS $function$
DECLARE
  v_bet aviator.game_bets%ROWTYPE;
  v_round aviator.game_rounds%ROWTYPE;
  v_elapsed numeric;
  v_exponent numeric;
  v_live numeric;
  v_cashout_multiplier numeric;
  v_payout bigint;
BEGIN
  IF p_bet_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'BET_AND_USER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bet FROM aviator.game_bets WHERE id = p_bet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;
  IF v_bet.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'BET_NOT_OWNED_BY_USER'; END IF;

  -- Crash, cashout, and round advancement all serialize on this same round row.
  SELECT * INTO v_round
    FROM aviator.game_rounds
   WHERE id = v_bet.round_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  SELECT * INTO v_bet FROM aviator.game_bets WHERE id = p_bet_id FOR UPDATE;

  IF v_bet.status = 'WON' THEN
    RETURN jsonb_build_object('betId',v_bet.id,'status',v_bet.status,
      'payoutAmount',v_bet.payout_amount,'multiplier',v_bet.cashed_out_at,'replayed',true);
  END IF;
  IF v_bet.status <> 'PENDING' THEN RAISE EXCEPTION 'BET_NOT_CASHOUTABLE'; END IF;
  IF v_bet.funding_status <> 'FUNDED' THEN RAISE EXCEPTION 'BET_NOT_FUNDED'; END IF;
  IF v_round.status <> 'RUNNING' THEN RAISE EXCEPTION 'ROUND_NOT_RUNNING'; END IF;

  v_elapsed := greatest(0, extract(epoch FROM (clock_timestamp() - v_round.started_at)));
  v_exponent := 0.06 * power(v_elapsed, 1.15);
  v_live := least(100000, floor(exp(least(ln(100000::numeric),v_exponent))*100)/100);
  IF v_live >= v_round.crash_multiplier THEN
    UPDATE aviator.game_rounds
       SET status='CRASHED', ended_at=clock_timestamp(), revealed_server_seed=server_seed
     WHERE id=v_round.id;
    UPDATE aviator.game_bets
       SET status='LOST', updated_at=clock_timestamp()
     WHERE round_id=v_round.id AND status='PENDING' AND funding_status='FUNDED';
    UPDATE aviator.game_bets
       SET status='CANCELLED', updated_at=clock_timestamp()
     WHERE round_id=v_round.id AND status='PENDING' AND funding_status='FAILED';
    RETURN jsonb_build_object('betId',v_bet.id,'status','ROUND_CRASHED','cashoutAccepted',false);
  END IF;

  IF v_live < 1.01 THEN RAISE EXCEPTION 'MULTIPLIER_NOT_CASHOUTABLE'; END IF;
  v_cashout_multiplier := v_live;
  IF v_bet.auto_cashout IS NOT NULL AND v_live >= v_bet.auto_cashout THEN
    v_cashout_multiplier := v_bet.auto_cashout;
  END IF;

  v_payout := floor(v_bet.bet_amount::numeric * v_cashout_multiplier)::bigint;
  UPDATE aviator.game_bets
     SET status='WON', cashed_out_at=v_cashout_multiplier,
         payout_amount=v_payout, updated_at=clock_timestamp()
   WHERE id=p_bet_id;
  INSERT INTO aviator.game_settlements(
    bet_id,round_id,payout_multiplier,net_win_amount,settlement_status,idempotency_key
  ) VALUES (
    v_bet.id,v_bet.round_id,v_cashout_multiplier,v_payout,'PENDING',
    'aviator_payout_' || v_bet.id::text
  )
  ON CONFLICT (bet_id) DO NOTHING;

  RETURN jsonb_build_object('betId',v_bet.id,'status','WON',
    'payoutAmount',v_payout,'multiplier',v_cashout_multiplier,'replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.tick_round_engine()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator, extensions
AS $function$
DECLARE
  v_round aviator.game_rounds%ROWTYPE;
  v_server_seed text;
  v_client_seed text;
  v_seed_digest bytea;
  v_crash_digest bytea;
  v_h numeric;
  v_e constant numeric := 281474976710656; -- 2^48
  v_crash_multiplier numeric;
  v_elapsed numeric;
  v_exponent numeric;
  v_live numeric;
  v_round_number bigint;
  v_auto record;
  v_payout bigint;
  v_losers integer := 0;
BEGIN
  -- One scheduler tick at a time, including the no-active-round creation path.
  PERFORM pg_advisory_xact_lock(hashtextextended('aviator-round-engine',0));

  SELECT * INTO v_round
    FROM aviator.game_rounds
   WHERE game_code='aviator' AND status IN ('WAITING','RUNNING')
   ORDER BY round_number DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(max(round_number),0)+1 INTO v_round_number
      FROM aviator.game_rounds WHERE game_code='aviator';
    v_server_seed := encode(extensions.gen_random_bytes(32),'hex');
    v_client_seed := NULL;
    v_seed_digest := extensions.digest(convert_to(v_server_seed,'UTF8'),'sha256');
    v_crash_digest := extensions.digest(
      convert_to(v_server_seed || ':' || v_round_number::text || ':' || COALESCE(v_client_seed,''),'UTF8'),
      'sha256'
    );
    v_h := get_byte(v_crash_digest,0)::numeric * 1099511627776
         + get_byte(v_crash_digest,1)::numeric * 4294967296
         + get_byte(v_crash_digest,2)::numeric * 16777216
         + get_byte(v_crash_digest,3)::numeric * 65536
         + get_byte(v_crash_digest,4)::numeric * 256
         + get_byte(v_crash_digest,5)::numeric;
    IF mod(v_h,101)=0 THEN
      v_crash_multiplier := 1.00;
    ELSE
      v_crash_multiplier := least(100000::numeric,
        greatest(1::numeric, floor((100*v_e-v_h)/(v_e-v_h))/100.0));
    END IF;

    INSERT INTO aviator.game_rounds(
      game_code,round_number,status,server_seed,client_seed,server_seed_hash,
      crash_multiplier,started_at
    ) VALUES (
      'aviator',v_round_number,'WAITING',v_server_seed,v_client_seed,
      encode(v_seed_digest,'hex'),v_crash_multiplier,clock_timestamp()
    ) RETURNING * INTO v_round;

    RETURN jsonb_build_object('roundId',v_round.id,'roundNumber',v_round.round_number,
      'status','WAITING','multiplier',1,'serverSeedHash',v_round.server_seed_hash,
      'action','ROUND_CREATED');
  END IF;

  IF v_round.status='WAITING' THEN
    IF v_round.created_at > clock_timestamp() - interval '5 seconds' THEN
      RETURN jsonb_build_object('roundId',v_round.id,'roundNumber',v_round.round_number,
        'status','WAITING','action','WAITING_FOR_BETS');
    END IF;

    IF EXISTS (
      SELECT 1 FROM aviator.game_bets b
       WHERE b.round_id=v_round.id AND b.funding_status='PENDING'
    ) THEN
      RETURN jsonb_build_object('roundId',v_round.id,'roundNumber',v_round.round_number,
        'status','WAITING','action','WAITING_FOR_WALLET_RECONCILIATION');
    END IF;

    UPDATE aviator.game_rounds
       SET status='RUNNING',started_at=clock_timestamp()
     WHERE id=v_round.id;
    RETURN jsonb_build_object('roundId',v_round.id,'roundNumber',v_round.round_number,
      'status','RUNNING','multiplier',1,'action','ROUND_STARTED');
  END IF;

  v_elapsed := greatest(0,extract(epoch FROM (clock_timestamp()-v_round.started_at)));
  v_exponent := 0.06 * power(v_elapsed,1.15);
  v_live := least(100000, floor(exp(least(ln(100000::numeric),v_exponent))*100)/100);

  -- A crash wins over any auto-cashout when the server curve has reached the
  -- committed crash point. No request-supplied multiplier is consulted.
  IF v_live >= v_round.crash_multiplier THEN
    UPDATE aviator.game_rounds
       SET status='CRASHED',ended_at=clock_timestamp(),revealed_server_seed=server_seed
     WHERE id=v_round.id;

    UPDATE aviator.game_bets
       SET status='LOST',updated_at=clock_timestamp()
     WHERE round_id=v_round.id AND status='PENDING' AND funding_status='FUNDED';
    GET DIAGNOSTICS v_losers = ROW_COUNT;

    UPDATE aviator.game_bets
       SET status='CANCELLED',updated_at=clock_timestamp()
     WHERE round_id=v_round.id AND status='PENDING' AND funding_status='FAILED';

    RETURN jsonb_build_object('roundId',v_round.id,'roundNumber',v_round.round_number,
      'status','CRASHED','multiplier',v_round.crash_multiplier,
      'revealedServerSeed',v_round.server_seed,'lostBets',v_losers,'action','ROUND_CRASHED');
  END IF;

  -- Auto-cashout is decided here using the server's current curve, never by the
  -- multiplier sent by the frontend. Payout remains an intent for the payout worker.
  FOR v_auto IN
    SELECT b.id,b.bet_amount,b.auto_cashout
      FROM aviator.game_bets b
     WHERE b.round_id=v_round.id AND b.status='PENDING'
       AND b.funding_status='FUNDED' AND b.auto_cashout IS NOT NULL
       AND b.auto_cashout <= v_live
     ORDER BY b.created_at
     FOR UPDATE
  LOOP
    v_payout := floor(v_auto.bet_amount::numeric*v_auto.auto_cashout)::bigint;
    UPDATE aviator.game_bets
       SET status='WON',cashed_out_at=v_auto.auto_cashout,
           payout_amount=v_payout,updated_at=clock_timestamp()
     WHERE id=v_auto.id AND status='PENDING';

    INSERT INTO aviator.game_settlements(
      bet_id,round_id,payout_multiplier,net_win_amount,settlement_status,idempotency_key
    ) VALUES (
      v_auto.id,v_round.id,v_auto.auto_cashout,v_payout,'PENDING',
      'aviator_payout_' || v_auto.id::text
    ) ON CONFLICT (bet_id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('roundId',v_round.id,'roundNumber',v_round.round_number,
    'status','RUNNING','multiplier',v_live,'action','ROUND_RUNNING');
END;
$function$;

-- The legacy function accepted a client/backend-supplied crash point. Remove it.
REVOKE ALL ON FUNCTION aviator.cashout_bet_intent(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.cashout_bet_intent(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION aviator.tick_round_engine() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.tick_round_engine() TO service_role;

COMMIT;
