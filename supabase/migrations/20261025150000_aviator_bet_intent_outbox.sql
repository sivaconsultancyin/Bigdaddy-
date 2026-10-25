-- Durable bet intent + wallet-operation outbox for isolated Aviator.
-- This does not move money; the worker must execute the shared-wallet debit and
-- mark funding_status='FUNDED' only after a confirmed/idempotent wallet result.
BEGIN;

ALTER TABLE aviator.game_bets
  ADD COLUMN IF NOT EXISTS funding_status text NOT NULL DEFAULT 'PENDING'
  CHECK (funding_status IN ('PENDING','FUNDED','FAILED'));

CREATE INDEX IF NOT EXISTS aviator_game_bets_funding_idx
  ON aviator.game_bets (funding_status, created_at)
  WHERE funding_status IN ('PENDING','FAILED');

CREATE OR REPLACE FUNCTION aviator.create_bet_intent(
  p_round_id uuid,
  p_user_id uuid,
  p_bet_amount bigint,
  p_auto_cashout numeric,
  p_idempotency_key text,
  p_liability bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE
  v_round aviator.game_rounds%ROWTYPE;
  v_bet aviator.game_bets%ROWTYPE;
  v_existing aviator.game_bets%ROWTYPE;
  v_op_key text;
BEGIN
  IF p_round_id IS NULL OR p_user_id IS NULL
     OR p_bet_amount IS NULL OR p_bet_amount <= 0
     OR p_liability IS NULL OR p_liability < p_bet_amount
     OR p_liability > p_bet_amount * 50
     OR p_idempotency_key IS NULL
     OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 80
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]+$'
     OR (p_auto_cashout IS NOT NULL AND p_auto_cashout NOT BETWEEN 1.01 AND 50) THEN
    RAISE EXCEPTION 'INVALID_BET_PARAMETERS' USING ERRCODE = '22023';
  END IF;

  -- Serialize bet acceptance against round start/crash.
  SELECT * INTO v_round
    FROM aviator.game_rounds
   WHERE id = p_round_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'WAITING' THEN RAISE EXCEPTION 'ROUND_NOT_ACCEPTING_BETS'; END IF;

  SELECT * INTO v_existing
    FROM aviator.game_bets
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.round_id IS DISTINCT FROM p_round_id
       OR v_existing.bet_amount IS DISTINCT FROM p_bet_amount
       OR v_existing.auto_cashout IS DISTINCT FROM p_auto_cashout THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'betId', v_existing.id,
      'status', v_existing.status,
      'fundingStatus', v_existing.funding_status,
      'replayed', true
    );
  END IF;

  INSERT INTO aviator.game_bets(
    round_id, user_id, bet_amount, auto_cashout, status,
    funding_status, idempotency_key
  ) VALUES (
    p_round_id, p_user_id, p_bet_amount, p_auto_cashout, 'PENDING',
    'PENDING', p_idempotency_key
  ) RETURNING * INTO v_bet;

  v_op_key := 'AVIATOR2_BET_LOCK_' || p_idempotency_key;
  INSERT INTO aviator.wallet_operations(
    bet_id, operation_type, amount, idempotency_key, status
  ) VALUES (
    v_bet.id, 'DEBIT_BET', p_bet_amount, v_op_key, 'PENDING'
  );

  RETURN jsonb_build_object(
    'betId', v_bet.id,
    'status', v_bet.status,
    'fundingStatus', v_bet.funding_status,
    'walletOperationKey', v_op_key,
    'replayed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION aviator.create_bet_intent(uuid,uuid,bigint,numeric,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.create_bet_intent(uuid,uuid,bigint,numeric,text,bigint)
  TO service_role;

COMMIT;
