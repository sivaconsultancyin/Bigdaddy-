-- Harden the central wallet transfer idempotency contract.
-- A key may replay only the exact same transfer. A conflicting replay must fail.
-- All table references are schema-qualified and the SECURITY DEFINER search_path
-- excludes public to avoid object-shadowing attacks.
BEGIN;

CREATE OR REPLACE FUNCTION public.wallet_transfer_atomic(
  p_idempotency_key text,
  p_type public.transaction_type_enum,
  p_amount bigint,
  p_source_wallet_id uuid,
  p_target_wallet_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing public.wallet_transactions%ROWTYPE;
  v_source_balance bigint;
  v_target_balance bigint;
  v_tx_id uuid;
  v_max_supply bigint;
  v_total_supply numeric;
BEGIN
  IF p_idempotency_key IS NULL
     OR length(trim(p_idempotency_key)) < 8
     OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL THEN
    RAISE EXCEPTION 'TRANSACTION_TYPE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE' USING ERRCODE = '22023';
  END IF;
  IF p_source_wallet_id IS NULL OR p_target_wallet_id IS NULL
     OR p_source_wallet_id = p_target_wallet_id THEN
    RAISE EXCEPTION 'INVALID_WALLET_PAIR' USING ERRCODE = '22023';
  END IF;

  -- Fast replay path: never let an idempotency key alias a different transfer.
  SELECT * INTO v_existing
  FROM public.wallet_transactions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.type IS DISTINCT FROM p_type
       OR COALESCE(v_existing.metadata, '{}'::jsonb)
          IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;

  -- Lock wallets in a stable order before reading or mutating balances.
  PERFORM w.id
  FROM public.wallets AS w
  WHERE w.id IN (p_source_wallet_id, p_target_wallet_id)
  ORDER BY w.id
  FOR UPDATE;

  -- Recheck after acquiring wallet locks; the other request may have committed
  -- while this request was waiting on a shared wallet.
  SELECT * INTO v_existing
  FROM public.wallet_transactions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.type IS DISTINCT FROM p_type
       OR COALESCE(v_existing.metadata, '{}'::jsonb)
          IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT w.balance INTO v_source_balance
  FROM public.wallets AS w
  WHERE w.id = p_source_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOURCE_WALLET_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  SELECT w.balance INTO v_target_balance
  FROM public.wallets AS w
  WHERE w.id = p_target_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TARGET_WALLET_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  IF v_source_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS' USING ERRCODE = '22003';
  END IF;

  INSERT INTO public.wallet_transactions (
    idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata
  ) VALUES (
    p_idempotency_key, p_type, p_amount, p_source_wallet_id, p_target_wallet_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = p_source_wallet_id
  RETURNING balance INTO v_source_balance;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = p_target_wallet_id
  RETURNING balance INTO v_target_balance;

  INSERT INTO public.ledger_entries (
    transaction_id, wallet_id, direction, amount, balance_after, description
  ) VALUES
    (v_tx_id, p_source_wallet_id, 'DEBIT', p_amount, v_source_balance,
     'Atomic wallet transfer debit'),
    (v_tx_id, p_target_wallet_id, 'CREDIT', p_amount, v_target_balance,
     'Atomic wallet transfer credit');

  SELECT ts.max_supply INTO v_max_supply
  FROM public.token_supply AS ts
  WHERE ts.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOKEN_SUPPLY_MASTER_MISSING';
  END IF;

  SELECT COALESCE(SUM(w.balance::numeric + COALESCE(w.reserved_balance, 0)::numeric), 0)
  INTO v_total_supply
  FROM public.wallets AS w;

  IF v_total_supply <> v_max_supply THEN
    RAISE EXCEPTION 'TOKEN_SUPPLY_INVARIANT_VIOLATED: total %, expected %',
      v_total_supply, v_max_supply;
  END IF;

  RETURN v_tx_id;

EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent requests may race on the unique idempotency key. PostgreSQL
    -- rolls back this function block before we inspect the committed winner.
    SELECT * INTO v_existing
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
         OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
         OR v_existing.amount IS DISTINCT FROM p_amount
         OR v_existing.type IS DISTINCT FROM p_type
         OR COALESCE(v_existing.metadata, '{}'::jsonb)
            IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
      END IF;
      RETURN v_existing.id;
    END IF;
    RAISE;
END;
$function$;

COMMENT ON FUNCTION public.wallet_transfer_atomic(
  text, public.transaction_type_enum, bigint, uuid, uuid, jsonb
) IS 'Atomic double-entry wallet transfer; exact-request idempotency replay only, stable wallet locks, and fixed token-supply invariant.';

REVOKE ALL ON FUNCTION public.wallet_transfer_atomic(
  text, public.transaction_type_enum, bigint, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

COMMIT;
