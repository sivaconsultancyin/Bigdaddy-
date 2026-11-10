-- Durable, idempotent payout and crash-loss settlement for isolated Aviator.
-- Additive: preserves existing records and never calls the shared wallet itself.
BEGIN;

ALTER TABLE aviator.game_settlements
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE aviator.wallet_operations
  DROP CONSTRAINT IF EXISTS wallet_operations_operation_type_check;
ALTER TABLE aviator.wallet_operations
  ADD CONSTRAINT wallet_operations_operation_type_check
  CHECK (operation_type IN ('DEBIT_BET','CREDIT_PAYOUT','REFUND_BET','CRASH_LOSS'));

CREATE INDEX IF NOT EXISTS aviator_settlement_claim_idx
  ON aviator.game_settlements (next_attempt_at, created_at)
  WHERE settlement_status IN ('PENDING','RETRY','PROCESSING');

-- A loss must release its reserved liability in the shared wallet. Create a
-- durable outbox record in the same transaction as the authoritative LOST state.
CREATE OR REPLACE FUNCTION aviator.enqueue_crash_loss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE
  v_liability bigint;
BEGIN
  IF NEW.status = 'LOST' AND OLD.status IS DISTINCT FROM 'LOST'
     AND NEW.funding_status = 'FUNDED' THEN
    SELECT liability INTO v_liability
      FROM aviator.wallet_operations
     WHERE bet_id = NEW.id AND operation_type = 'DEBIT_BET'
     ORDER BY created_at
     LIMIT 1;
    IF v_liability IS NULL OR v_liability < NEW.bet_amount THEN
      RAISE EXCEPTION 'AVIATOR_RESERVED_LIABILITY_MISSING';
    END IF;
    INSERT INTO aviator.wallet_operations(
      bet_id, operation_type, amount, liability, idempotency_key, status
    ) VALUES (
      NEW.id, 'CRASH_LOSS', NEW.bet_amount, v_liability,
      'aviator_loss_' || NEW.id::text, 'PENDING'
    ) ON CONFLICT (bet_id, operation_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aviator_enqueue_crash_loss ON aviator.game_bets;
CREATE TRIGGER aviator_enqueue_crash_loss
AFTER UPDATE OF status ON aviator.game_bets
FOR EACH ROW EXECUTE FUNCTION aviator.enqueue_crash_loss();

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
    RAISE EXCEPTION 'INVALID_BATCH_SIZE' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
      FROM aviator.game_settlements s
     WHERE s.settlement_status IN ('PENDING','RETRY','PROCESSING')
       AND s.next_attempt_at <= now()
       AND (s.settlement_status <> 'PROCESSING'
            OR s.updated_at < now() - interval '2 minutes')
     ORDER BY s.next_attempt_at, s.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE aviator.game_settlements s
       SET settlement_status='PROCESSING',
           attempts=s.attempts+1,
           next_attempt_at=now()+interval '2 minutes',
           last_error_code=NULL,
           updated_at=now()
      FROM candidates c
     WHERE s.id=c.id
     RETURNING s.id,s.bet_id,s.round_id,s.payout_multiplier,s.idempotency_key,s.attempts
  )
  SELECT c.id,b.id,b.user_id,b.round_id,b.bet_amount,
         debit.liability,c.idempotency_key,c.payout_multiplier,c.attempts
    FROM claimed c
    JOIN aviator.game_bets b ON b.id=c.bet_id
    JOIN aviator.wallet_operations debit
      ON debit.bet_id=b.id AND debit.operation_type='DEBIT_BET'
   WHERE debit.liability IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.complete_payout_settlement(
  p_settlement_id uuid, p_wallet_transaction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE v_status text; v_existing uuid;
BEGIN
  IF p_settlement_id IS NULL OR p_wallet_transaction_id IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_AND_TRANSACTION_REQUIRED' USING ERRCODE='22023';
  END IF;
  SELECT settlement_status,wallet_transaction_id INTO v_status,v_existing
    FROM aviator.game_settlements WHERE id=p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;
  IF v_status='SUCCEEDED' THEN
    IF v_existing IS DISTINCT FROM p_wallet_transaction_id THEN
      RAISE EXCEPTION 'SETTLEMENT_RESULT_CONFLICT';
    END IF;
    RETURN true;
  END IF;
  UPDATE aviator.game_settlements
     SET settlement_status='SUCCEEDED',wallet_transaction_id=p_wallet_transaction_id,
         settled_at=now(),last_error_code=NULL,updated_at=now()
   WHERE id=p_settlement_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.fail_payout_settlement(
  p_settlement_id uuid, p_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE v_attempts integer; v_status text; v_safe_error text;
BEGIN
  v_safe_error := left(regexp_replace(COALESCE(p_error_code,'SETTLEMENT_FAILED'),
                                     '[^A-Za-z0-9_:-]','','g'),80);
  IF v_safe_error='' THEN v_safe_error:='SETTLEMENT_FAILED'; END IF;
  SELECT attempts,settlement_status INTO v_attempts,v_status
    FROM aviator.game_settlements WHERE id=p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;
  IF v_status='SUCCEEDED' THEN RETURN 'SUCCEEDED'; END IF;
  UPDATE aviator.game_settlements
     SET settlement_status='RETRY',last_error_code=v_safe_error,
         next_attempt_at=now()+make_interval(secs=>LEAST(300,(2 ^ LEAST(v_attempts,8))::integer)),
         updated_at=now()
   WHERE id=p_settlement_id;
  RETURN 'RETRY';
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.claim_crash_loss_operations(p_limit integer DEFAULT 20)
RETURNS TABLE (
  operation_id uuid, bet_id uuid, user_id uuid, round_id uuid,
  amount bigint, liability bigint, idempotency_key text, attempt_number integer
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
    SELECT wo.id FROM aviator.wallet_operations wo
     WHERE wo.operation_type='CRASH_LOSS' AND wo.next_attempt_at<=now()
       AND (wo.status IN ('PENDING','RETRY')
         OR (wo.status='PROCESSING' AND wo.updated_at<now()-interval '2 minutes'))
     ORDER BY wo.next_attempt_at,wo.created_at
     FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE aviator.wallet_operations wo
       SET status='PROCESSING',attempts=wo.attempts+1,
           next_attempt_at=now()+interval '2 minutes',
           last_error_code=NULL,updated_at=now()
      FROM candidates c WHERE wo.id=c.id
      RETURNING wo.id,wo.bet_id,wo.amount,wo.liability,wo.idempotency_key,wo.attempts
  )
  SELECT c.id,b.id,b.user_id,b.round_id,c.amount,c.liability,c.idempotency_key,c.attempts
    FROM claimed c JOIN aviator.game_bets b ON b.id=c.bet_id;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.complete_crash_loss_operation(
  p_operation_id uuid,p_wallet_transaction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE v_status text; v_existing uuid;
BEGIN
  IF p_operation_id IS NULL OR p_wallet_transaction_id IS NULL THEN
    RAISE EXCEPTION 'OPERATION_AND_TRANSACTION_REQUIRED' USING ERRCODE='22023';
  END IF;
  SELECT status,wallet_transaction_id INTO v_status,v_existing
    FROM aviator.wallet_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_OPERATION_NOT_FOUND'; END IF;
  IF v_status='SUCCEEDED' THEN
    IF v_existing IS DISTINCT FROM p_wallet_transaction_id THEN
      RAISE EXCEPTION 'WALLET_OPERATION_RESULT_CONFLICT';
    END IF;
    RETURN true;
  END IF;
  UPDATE aviator.wallet_operations
     SET status='SUCCEEDED',wallet_transaction_id=p_wallet_transaction_id,
         last_error_code=NULL,updated_at=now()
   WHERE id=p_operation_id AND operation_type='CRASH_LOSS';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_A_CRASH_LOSS_OPERATION'; END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.fail_crash_loss_operation(
  p_operation_id uuid,p_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE v_attempts integer; v_status text; v_safe_error text;
BEGIN
  v_safe_error := left(regexp_replace(COALESCE(p_error_code,'WALLET_OPERATION_FAILED'),
                                     '[^A-Za-z0-9_:-]','','g'),80);
  IF v_safe_error='' THEN v_safe_error:='WALLET_OPERATION_FAILED'; END IF;
  SELECT attempts,status INTO v_attempts,v_status
    FROM aviator.wallet_operations
   WHERE id=p_operation_id AND operation_type='CRASH_LOSS' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRASH_LOSS_OPERATION_NOT_FOUND'; END IF;
  IF v_status='SUCCEEDED' THEN RETURN 'SUCCEEDED'; END IF;
  UPDATE aviator.wallet_operations
     SET status='RETRY',last_error_code=v_safe_error,
         next_attempt_at=now()+make_interval(secs=>LEAST(300,(2 ^ LEAST(v_attempts,8))::integer)),
         updated_at=now()
   WHERE id=p_operation_id;
  RETURN 'RETRY';
END;
$function$;

REVOKE ALL ON FUNCTION aviator.enqueue_crash_loss() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION aviator.claim_payout_settlements(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION aviator.complete_payout_settlement(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION aviator.fail_payout_settlement(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION aviator.claim_crash_loss_operations(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION aviator.complete_crash_loss_operation(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION aviator.fail_crash_loss_operation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION aviator.claim_payout_settlements(integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.complete_payout_settlement(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.fail_payout_settlement(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.claim_crash_loss_operations(integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.complete_crash_loss_operation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.fail_crash_loss_operation(uuid,text) TO service_role;

COMMIT;
