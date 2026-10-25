-- Durable, lease-based claim and completion for the isolated Aviator wallet outbox.
-- The shared-wallet call is deliberately outside this transaction; retries use
-- the same source-wallet idempotency key if the worker crashes after debit.

CREATE OR REPLACE FUNCTION aviator.claim_wallet_operations(p_limit integer DEFAULT 20)
RETURNS TABLE (
  operation_id uuid,
  bet_id uuid,
  operation_type text,
  amount bigint,
  liability bigint,
  idempotency_key text,
  user_id uuid,
  round_id uuid,
  attempt_number integer
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
    SELECT wo.id
      FROM aviator.wallet_operations wo
     WHERE wo.operation_type = 'DEBIT_BET'
       AND wo.next_attempt_at <= now()
       AND (
         wo.status IN ('PENDING', 'RETRY')
         OR (wo.status = 'PROCESSING' AND wo.updated_at < now() - interval '2 minutes')
       )
     ORDER BY wo.next_attempt_at, wo.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  ),
  claimed AS (
    UPDATE aviator.wallet_operations wo
       SET status = 'PROCESSING',
           attempts = wo.attempts + 1,
           next_attempt_at = now() + interval '2 minutes',
           last_error_code = NULL,
           updated_at = now()
      FROM candidates c
     WHERE wo.id = c.id
     RETURNING wo.id, wo.bet_id, wo.operation_type, wo.amount,
               wo.liability, wo.idempotency_key, wo.attempts
  )
  SELECT c.id, b.id, c.operation_type, c.amount, c.liability,
         c.idempotency_key::text, b.user_id, b.round_id, c.attempts
    FROM claimed c
    JOIN aviator.game_bets b ON b.id = c.bet_id;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.complete_wallet_operation(
  p_operation_id uuid,
  p_wallet_transaction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE
  v_bet_id uuid;
  v_status text;
BEGIN
  IF p_operation_id IS NULL OR p_wallet_transaction_id IS NULL THEN
    RAISE EXCEPTION 'OPERATION_AND_TRANSACTION_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT wo.bet_id, wo.status
    INTO v_bet_id, v_status
    FROM aviator.wallet_operations wo
   WHERE wo.id = p_operation_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_OPERATION_NOT_FOUND'; END IF;

  IF v_status = 'SUCCEEDED' THEN
    IF EXISTS (
      SELECT 1 FROM aviator.wallet_operations wo
       WHERE wo.id = p_operation_id
         AND wo.wallet_transaction_id IS DISTINCT FROM p_wallet_transaction_id
    ) THEN
      RAISE EXCEPTION 'WALLET_OPERATION_RESULT_CONFLICT';
    END IF;
    RETURN true;
  END IF;

  UPDATE aviator.wallet_operations
     SET status = 'SUCCEEDED',
         wallet_transaction_id = p_wallet_transaction_id,
         last_error_code = NULL,
         updated_at = now()
   WHERE id = p_operation_id;

  UPDATE aviator.game_bets
     SET funding_status = 'FUNDED',
         updated_at = now()
   WHERE id = v_bet_id
     AND funding_status = 'PENDING';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM aviator.game_bets
     WHERE id = v_bet_id AND funding_status = 'FUNDED'
  ) THEN
    RAISE EXCEPTION 'BET_FUNDING_STATE_CONFLICT';
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION aviator.fail_wallet_operation(
  p_operation_id uuid,
  p_error_code text,
  p_permanent boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE
  v_bet_id uuid;
  v_status text;
  v_attempts integer;
  v_new_status text;
  v_safe_error text;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'OPERATION_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Persist only short, sanitized error codes; never persist request payloads,
  -- JWTs, secrets, or raw PostgREST error bodies.
  v_safe_error := left(regexp_replace(COALESCE(p_error_code, 'WALLET_OPERATION_FAILED'),
                                      '[^A-Za-z0-9_:-]', '', 'g'), 80);
  IF v_safe_error = '' THEN v_safe_error := 'WALLET_OPERATION_FAILED'; END IF;

  SELECT wo.bet_id, wo.status, wo.attempts
    INTO v_bet_id, v_status, v_attempts
    FROM aviator.wallet_operations wo
   WHERE wo.id = p_operation_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_OPERATION_NOT_FOUND'; END IF;
  IF v_status = 'SUCCEEDED' THEN RETURN 'SUCCEEDED'; END IF;

  v_new_status := CASE WHEN p_permanent THEN 'FAILED' ELSE 'RETRY' END;

  UPDATE aviator.wallet_operations
     SET status = v_new_status,
         last_error_code = v_safe_error,
         next_attempt_at = CASE
           WHEN p_permanent THEN next_attempt_at
           ELSE now() + make_interval(secs => LEAST(300, (2 ^ LEAST(v_attempts, 8))::integer))
         END,
         updated_at = now()
   WHERE id = p_operation_id;

  IF p_permanent THEN
    UPDATE aviator.game_bets
       SET funding_status = 'FAILED',
           updated_at = now()
     WHERE id = v_bet_id
       AND funding_status = 'PENDING';
  END IF;

  RETURN v_new_status;
END;
$function$;

REVOKE ALL ON FUNCTION aviator.claim_wallet_operations(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.complete_wallet_operation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.fail_wallet_operation(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.claim_wallet_operations(integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.complete_wallet_operation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.fail_wallet_operation(uuid, text, boolean) TO service_role;
