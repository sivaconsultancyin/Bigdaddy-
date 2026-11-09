-- Align every authoritative payout with the shared wallet's 50x liability ceiling.
-- Also make orphaned payout intents visible to the worker rather than silently
-- claiming them and filtering them out of the claim result.
BEGIN;

ALTER TABLE aviator.game_settlements
  DROP CONSTRAINT IF EXISTS game_settlements_payout_multiplier_check;
ALTER TABLE aviator.game_settlements
  ADD CONSTRAINT game_settlements_payout_multiplier_check
  CHECK (payout_multiplier >= 1 AND payout_multiplier <= 50);

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
  SELECT * INTO v_bet FROM aviator.game_bets WHERE id=p_bet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;
  IF v_bet.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'BET_NOT_OWNED_BY_USER'; END IF;

  SELECT * INTO v_round FROM aviator.game_rounds WHERE id=v_bet.round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  SELECT * INTO v_bet FROM aviator.game_bets WHERE id=p_bet_id FOR UPDATE;

  IF v_bet.status='WON' THEN
    RETURN jsonb_build_object('betId',v_bet.id,'status',v_bet.status,
      'payoutAmount',v_bet.payout_amount,'multiplier',v_bet.cashed_out_at,'replayed',true);
  END IF;
  IF v_bet.status <> 'PENDING' THEN RAISE EXCEPTION 'BET_NOT_CASHOUTABLE'; END IF;
  IF v_bet.funding_status <> 'FUNDED' THEN RAISE EXCEPTION 'BET_NOT_FUNDED'; END IF;
  IF v_round.status <> 'RUNNING' THEN RAISE EXCEPTION 'ROUND_NOT_RUNNING'; END IF;

  v_elapsed := greatest(0,extract(epoch FROM (clock_timestamp()-v_round.started_at)));
  v_exponent := 0.06 * power(v_elapsed,1.15);
  v_live := least(100000,floor(exp(least(ln(100000::numeric),v_exponent))*100)/100);
  IF v_live >= v_round.crash_multiplier THEN
    UPDATE aviator.game_rounds SET status='CRASHED',ended_at=clock_timestamp(),
      revealed_server_seed=server_seed WHERE id=v_round.id;
    UPDATE aviator.game_bets SET status='LOST',updated_at=clock_timestamp()
      WHERE round_id=v_round.id AND status='PENDING' AND funding_status='FUNDED';
    UPDATE aviator.game_bets SET status='CANCELLED',updated_at=clock_timestamp()
      WHERE round_id=v_round.id AND status='PENDING' AND funding_status='FAILED';
    RETURN jsonb_build_object('betId',v_bet.id,'status','ROUND_CRASHED','cashoutAccepted',false);
  END IF;

  IF v_live < 1.01 THEN RAISE EXCEPTION 'MULTIPLIER_NOT_CASHOUTABLE'; END IF;

  -- Shared wallet limits both configured liability and payout to 50x stake.
  -- If the live curve has passed 50x, cashout is settled at the maximum supported
  -- multiplier rather than creating a settlement the wallet will reject forever.
  v_cashout_multiplier := least(v_live,50::numeric);
  IF v_bet.auto_cashout IS NOT NULL AND v_live >= v_bet.auto_cashout THEN
    v_cashout_multiplier := v_bet.auto_cashout;
  END IF;
  IF v_cashout_multiplier < 1.01 OR v_cashout_multiplier > 50 THEN
    RAISE EXCEPTION 'INVALID_CASHOUT_MULTIPLIER';
  END IF;

  v_payout := floor(v_bet.bet_amount::numeric*v_cashout_multiplier)::bigint;
  UPDATE aviator.game_bets SET status='WON',cashed_out_at=v_cashout_multiplier,
    payout_amount=v_payout,updated_at=clock_timestamp() WHERE id=p_bet_id;
  INSERT INTO aviator.game_settlements(
    bet_id,round_id,payout_multiplier,net_win_amount,settlement_status,idempotency_key
  ) VALUES (
    v_bet.id,v_bet.round_id,v_cashout_multiplier,v_payout,'PENDING',
    'aviator_payout_'||v_bet.id::text
  ) ON CONFLICT (bet_id) DO NOTHING;

  RETURN jsonb_build_object('betId',v_bet.id,'status','WON',
    'payoutAmount',v_payout,'multiplier',v_cashout_multiplier,'replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.claim_payout_settlements(p_limit integer DEFAULT 20)
RETURNS TABLE (
  settlement_id uuid, bet_id uuid, user_id uuid, round_id uuid,
  amount bigint, liability bigint, idempotency_key text,
  multiplier numeric, attempt_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id FROM aviator.game_settlements s
     WHERE s.settlement_status IN ('PENDING','RETRY','PROCESSING')
       AND s.next_attempt_at<=now()
       AND (s.settlement_status<>'PROCESSING'
         OR s.updated_at<now()-interval '2 minutes')
     ORDER BY s.next_attempt_at,s.created_at
     FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE aviator.game_settlements s
       SET settlement_status='PROCESSING',attempts=s.attempts+1,
           next_attempt_at=now()+interval '2 minutes',
           last_error_code=NULL,updated_at=now()
      FROM candidates c WHERE s.id=c.id
      RETURNING s.id,s.bet_id,s.round_id,s.payout_multiplier,s.idempotency_key,s.attempts
  )
  SELECT c.id,b.id,b.user_id,b.round_id,b.bet_amount,
         debit.liability,c.idempotency_key,c.payout_multiplier,c.attempts
    FROM claimed c
    JOIN aviator.game_bets b ON b.id=c.bet_id
    LEFT JOIN aviator.wallet_operations debit
      ON debit.bet_id=b.id AND debit.operation_type='DEBIT_BET';
END;
$function$;

REVOKE ALL ON FUNCTION aviator.cashout_bet_intent(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION aviator.cashout_bet_intent(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION aviator.claim_payout_settlements(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION aviator.claim_payout_settlements(integer) TO service_role;

COMMIT;
