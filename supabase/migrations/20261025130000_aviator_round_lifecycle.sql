-- Atomic round lifecycle primitives for the isolated Aviator database.
-- No wallet is touched by these functions. Wallet operations remain a separate,
-- idempotent saga and must be reconciled by the worker before bets are considered funded.
BEGIN;

CREATE OR REPLACE FUNCTION aviator.create_waiting_round(
  p_round_number bigint,
  p_server_seed text,
  p_server_seed_hash text,
  p_crash_multiplier numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator, extensions
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_round_number IS NULL OR p_round_number < 1
     OR p_server_seed IS NULL OR length(p_server_seed) < 32
     OR p_server_seed_hash IS NULL OR length(p_server_seed_hash) < 32
     OR p_crash_multiplier IS NULL OR p_crash_multiplier < 1
     OR p_crash_multiplier > 100000 THEN
    RAISE EXCEPTION 'INVALID_ROUND_PARAMETERS' USING ERRCODE = '22023';
  END IF;

  -- A single active round per game. The unique round number also protects retries.
  PERFORM 1 FROM aviator.game_rounds
   WHERE game_code = 'aviator' AND status IN ('WAITING','RUNNING')
   FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'ACTIVE_ROUND_EXISTS'; END IF;

  INSERT INTO aviator.game_rounds(
    round_number,status,server_seed,server_seed_hash,crash_multiplier
  ) VALUES (
    p_round_number,'WAITING',p_server_seed,p_server_seed_hash,p_crash_multiplier
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.start_round(p_round_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM aviator.game_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_status = 'RUNNING' THEN RETURN true; END IF;
  IF v_status <> 'WAITING' THEN RAISE EXCEPTION 'ROUND_NOT_WAITING'; END IF;
  UPDATE aviator.game_rounds SET status='RUNNING', started_at=now() WHERE id=p_round_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.cashout_bet_intent(
  p_bet_id uuid,
  p_multiplier numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE
  v_bet aviator.game_bets%ROWTYPE;
  v_round aviator.game_rounds%ROWTYPE;
  v_payout bigint;
BEGIN
  IF p_multiplier IS NULL OR p_multiplier < 1.01 OR p_multiplier > 100000 THEN
    RAISE EXCEPTION 'INVALID_CASHOUT_MULTIPLIER' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bet FROM aviator.game_bets WHERE id=p_bet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;
  -- Lock round first so crash and cashout serialize on the same row.
  SELECT * INTO v_round FROM aviator.game_rounds WHERE id=v_bet.round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  SELECT * INTO v_bet FROM aviator.game_bets WHERE id=p_bet_id FOR UPDATE;

  IF v_bet.status='WON' THEN
    RETURN jsonb_build_object('betId',v_bet.id,'status',v_bet.status,
      'payoutAmount',v_bet.payout_amount,'multiplier',v_bet.cashed_out_at,'replayed',true);
  END IF;
  IF v_bet.status <> 'PENDING' THEN RAISE EXCEPTION 'BET_NOT_CASHOUTABLE'; END IF;
  IF v_round.status <> 'RUNNING' THEN RAISE EXCEPTION 'ROUND_NOT_RUNNING'; END IF;
  IF p_multiplier >= v_round.crash_multiplier THEN RAISE EXCEPTION 'ROUND_ALREADY_CRASHED'; END IF;
  IF v_bet.auto_cashout IS NOT NULL AND p_multiplier > v_bet.auto_cashout THEN
    RAISE EXCEPTION 'MULTIPLIER_ABOVE_AUTO_CASHOUT';
  END IF;

  v_payout := floor(v_bet.bet_amount::numeric * p_multiplier)::bigint;
  UPDATE aviator.game_bets
     SET status='WON', cashed_out_at=p_multiplier, payout_amount=v_payout, updated_at=now()
   WHERE id=p_bet_id;
  INSERT INTO aviator.game_settlements(
    bet_id,round_id,payout_multiplier,net_win_amount,settlement_status,idempotency_key
  ) VALUES (
    v_bet.id,v_bet.round_id,p_multiplier,v_payout,'PENDING',
    'aviator_payout_' || v_bet.id::text
  )
  ON CONFLICT (bet_id) DO NOTHING;

  RETURN jsonb_build_object('betId',v_bet.id,'status','WON',
    'payoutAmount',v_payout,'multiplier',p_multiplier,'replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.crash_round(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE v_round aviator.game_rounds%ROWTYPE; v_losers integer;
BEGIN
  SELECT * INTO v_round FROM aviator.game_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status IN ('CRASHED','SETTLED') THEN
    RETURN jsonb_build_object('roundId',p_round_id,'status',v_round.status,'replayed',true);
  END IF;
  IF v_round.status <> 'RUNNING' THEN RAISE EXCEPTION 'ROUND_NOT_RUNNING'; END IF;

  UPDATE aviator.game_rounds
     SET status='CRASHED', ended_at=now(), revealed_server_seed=server_seed
   WHERE id=p_round_id;
  UPDATE aviator.game_bets
     SET status='LOST', updated_at=now()
   WHERE round_id=p_round_id AND status='PENDING';
  GET DIAGNOSTICS v_losers = ROW_COUNT;

  RETURN jsonb_build_object('roundId',p_round_id,'status','CRASHED',
    'lostBets',v_losers,'crashMultiplier',v_round.crash_multiplier,'replayed',false);
END;
$function$;

REVOKE ALL ON FUNCTION aviator.create_waiting_round(bigint,text,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.start_round(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.cashout_bet_intent(uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.crash_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.create_waiting_round(bigint,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.start_round(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.cashout_bet_intent(uuid,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.crash_round(uuid) TO service_role;

COMMIT;
