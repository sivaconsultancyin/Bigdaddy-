-- BigDaddy: atomic, idempotent wallet transfers.
-- Apply after 002_supabase_schema.sql. This function is intentionally not
-- SECURITY DEFINER; callers must connect with a trusted backend database role.
-- Every transfer updates both wallets, its transaction header, and both ledger
-- entries inside the caller's single PostgreSQL transaction.

CREATE OR REPLACE FUNCTION public.execute_wallet_transfer(
  p_source_wallet_id UUID,
  p_target_wallet_id UUID,
  p_amount BIGINT,
  p_type public.transaction_type_enum,
  p_idempotency_key VARCHAR(128),
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_existing public.wallet_transactions%ROWTYPE;
  v_transaction_id UUID;
  v_source_balance BIGINT;
  v_target_balance BIGINT;
  v_max_supply BIGINT;
  v_total_supply NUMERIC;
BEGIN
  IF p_source_wallet_id IS NULL OR p_target_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Source and target wallets are required';
  END IF;
  IF p_source_wallet_id = p_target_wallet_id THEN
    RAISE EXCEPTION 'Source and target wallets must be different';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;
  IF p_description IS NULL OR length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Transfer description is required';
  END IF;

  -- Replays return the original transaction only when the request matches.
  SELECT * INTO v_existing
  FROM public.wallet_transactions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
      OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
      OR v_existing.amount IS DISTINCT FROM p_amount
      OR v_existing.type IS DISTINCT FROM p_type THEN
      RAISE EXCEPTION 'Idempotency key reused with different transfer details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;

  -- Acquire row locks in a stable order to reduce deadlock risk.
  PERFORM id
  FROM public.wallets
  WHERE id IN (p_source_wallet_id, p_target_wallet_id)
  ORDER BY id
  FOR UPDATE;

  SELECT balance INTO v_source_balance
  FROM public.wallets WHERE id = p_source_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source wallet not found';
  END IF;

  SELECT balance INTO v_target_balance
  FROM public.wallets WHERE id = p_target_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target wallet not found';
  END IF;

  IF v_source_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance'
      USING ERRCODE = '22003';
  END IF;

  INSERT INTO public.wallet_transactions (
    idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata
  ) VALUES (
    p_idempotency_key, p_type, p_amount, p_source_wallet_id, p_target_wallet_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_transaction_id;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE id = p_source_wallet_id
  RETURNING balance INTO v_source_balance;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE id = p_target_wallet_id
  RETURNING balance INTO v_target_balance;

  INSERT INTO public.ledger_entries (
    transaction_id, wallet_id, direction, amount, balance_after, description
  ) VALUES
    (v_transaction_id, p_source_wallet_id, 'DEBIT', p_amount, v_source_balance,
     'DEBIT: ' || p_description),
    (v_transaction_id, p_target_wallet_id, 'CREDIT', p_amount, v_target_balance,
     'CREDIT: ' || p_description);

  -- Enforce the fixed token supply after each successful transfer.
  SELECT max_supply INTO v_max_supply
  FROM public.token_supply WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token supply master row is missing; initialize the system before transfers';
  END IF;

  SELECT COALESCE(SUM(balance::numeric + reserved_balance::numeric), 0)
  INTO v_total_supply
  FROM public.wallets;

  IF v_total_supply <> v_max_supply THEN
    RAISE EXCEPTION 'Token supply invariant violated: wallets total %, expected %',
      v_total_supply, v_max_supply;
  END IF;

  RETURN v_transaction_id;
END;
$function$;

COMMENT ON FUNCTION public.execute_wallet_transfer(UUID, UUID, BIGINT, public.transaction_type_enum, VARCHAR, TEXT, JSONB)
IS 'Atomic idempotent transfer with wallet row locks, double-entry ledger entries, and fixed token supply verification.';

-- This function is for the trusted backend database connection only.
-- Do not expose wallet transfer execution to Supabase anon/authenticated clients.
REVOKE ALL ON FUNCTION public.execute_wallet_transfer(UUID, UUID, BIGINT, public.transaction_type_enum, VARCHAR, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_wallet_transfer(UUID, UUID, BIGINT, public.transaction_type_enum, VARCHAR, TEXT, JSONB) FROM anon, authenticated;
