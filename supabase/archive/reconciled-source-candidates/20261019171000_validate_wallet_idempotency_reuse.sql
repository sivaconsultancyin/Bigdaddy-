-- An idempotency key may replay the same transfer, but must never silently
-- alias a different amount, type, source, or destination.
BEGIN;

CREATE OR REPLACE FUNCTION public.wallet_transfer_atomic(
  p_idempotency_key text,
  p_type public.transaction_type_enum,
  p_amount bigint,
  p_source_wallet_id uuid,
  p_target_wallet_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_existing public.wallet_transactions%ROWTYPE;
  v_source_balance bigint;
  v_target_balance bigint;
  v_tx_id uuid;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;
  IF p_source_wallet_id IS NULL OR p_target_wallet_id IS NULL OR p_source_wallet_id = p_target_wallet_id THEN
    RAISE EXCEPTION 'INVALID_WALLET_PAIR';
  END IF;

  SELECT * INTO v_existing FROM public.wallet_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.type IS DISTINCT FROM p_type
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE';
    END IF;
    RETURN v_existing.id;
  END IF;

  PERFORM id FROM public.wallets
    WHERE id IN (p_source_wallet_id, p_target_wallet_id)
    ORDER BY id FOR UPDATE;
  SELECT balance INTO v_source_balance FROM public.wallets WHERE id = p_source_wallet_id;
  SELECT balance INTO v_target_balance FROM public.wallets WHERE id = p_target_wallet_id;
  IF v_source_balance IS NULL OR v_target_balance IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
  IF v_source_balance < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  INSERT INTO public.wallet_transactions(idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata)
  VALUES (p_idempotency_key, p_type, p_amount, p_source_wallet_id, p_target_wallet_id, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_tx_id;

  UPDATE public.wallets SET balance = balance - p_amount, updated_at = now()
    WHERE id = p_source_wallet_id RETURNING balance INTO v_source_balance;
  UPDATE public.wallets SET balance = balance + p_amount, updated_at = now()
    WHERE id = p_target_wallet_id RETURNING balance INTO v_target_balance;

  INSERT INTO public.ledger_entries(transaction_id, wallet_id, direction, amount, balance_after, description)
  VALUES
    (v_tx_id, p_source_wallet_id, 'DEBIT', p_amount, v_source_balance, 'Atomic wallet transfer debit'),
    (v_tx_id, p_target_wallet_id, 'CREDIT', p_amount, v_target_balance, 'Atomic wallet transfer credit');
  RETURN v_tx_id;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.wallet_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.type IS DISTINCT FROM p_type
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE';
    END IF;
    RETURN v_existing.id;
  END IF;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION public.wallet_transfer_atomic(text,public.transaction_type_enum,bigint,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;

COMMIT;
