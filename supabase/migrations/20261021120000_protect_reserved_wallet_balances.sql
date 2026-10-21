-- Prevent transfers from consuming funds reserved for outstanding liabilities.
-- BET_WIN_PAYOUT is the only transfer type allowed to spend reserved game-pool
-- funds, and only when the payout is covered by the pool's current reservation.

CREATE OR REPLACE FUNCTION wallet.wallet_transfer_atomic(
  p_idempotency_key text,
  p_type public.transaction_type_enum,
  p_amount bigint,
  p_source_wallet_id uuid,
  p_target_wallet_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_existing wallet.wallet_transactions%ROWTYPE;
  v_source_balance bigint;
  v_source_reserved bigint;
  v_source_type public.wallet_type_enum;
  v_target_balance bigint;
  v_target_type public.wallet_type_enum;
  v_tx_id uuid;
  v_max_supply bigint;
  v_total_supply numeric;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL THEN RAISE EXCEPTION 'TRANSACTION_TYPE_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE' USING ERRCODE = '22023'; END IF;
  IF p_source_wallet_id IS NULL OR p_target_wallet_id IS NULL OR p_source_wallet_id = p_target_wallet_id THEN
    RAISE EXCEPTION 'INVALID_WALLET_PAIR' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM wallet.wallet_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.type IS DISTINCT FROM p_type
       OR COALESCE(v_existing.metadata, '{}'::jsonb) IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;

  PERFORM w.id FROM wallet.wallets AS w
  WHERE w.id IN (p_source_wallet_id, p_target_wallet_id)
  ORDER BY w.id FOR UPDATE;

  SELECT * INTO v_existing FROM wallet.wallet_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.type IS DISTINCT FROM p_type
       OR COALESCE(v_existing.metadata, '{}'::jsonb) IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT w.balance, w.reserved_balance, w.wallet_type
    INTO v_source_balance, v_source_reserved, v_source_type
    FROM wallet.wallets AS w WHERE w.id = p_source_wallet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_WALLET_NOT_FOUND' USING ERRCODE = '22023'; END IF;

  SELECT w.balance, w.wallet_type INTO v_target_balance, v_target_type
    FROM wallet.wallets AS w WHERE w.id = p_target_wallet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_WALLET_NOT_FOUND' USING ERRCODE = '22023'; END IF;

  IF p_type = 'BET_WIN_PAYOUT'::public.transaction_type_enum THEN
    IF v_source_type <> 'GAME_POOL'::public.wallet_type_enum
       OR v_target_type <> 'PLAYER'::public.wallet_type_enum THEN
      RAISE EXCEPTION 'INVALID_PAYOUT_WALLET_PAIR' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_source_reserved, 0) < p_amount THEN
      RAISE EXCEPTION 'PAYOUT_EXCEEDS_RESERVED_LIABILITY' USING ERRCODE = '22003';
    END IF;
  ELSIF v_source_balance - COALESCE(v_source_reserved, 0) < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_FUNDS' USING ERRCODE = '22003';
  END IF;

  INSERT INTO wallet.wallet_transactions (idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata)
  VALUES (p_idempotency_key, p_type, p_amount, p_source_wallet_id, p_target_wallet_id, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_tx_id;

  UPDATE wallet.wallets SET balance = balance - p_amount, updated_at = now()
    WHERE id = p_source_wallet_id RETURNING balance INTO v_source_balance;
  UPDATE wallet.wallets SET balance = balance + p_amount, updated_at = now()
    WHERE id = p_target_wallet_id RETURNING balance INTO v_target_balance;

  INSERT INTO wallet.ledger_entries (transaction_id, wallet_id, direction, amount, balance_after, description)
  VALUES (v_tx_id, p_source_wallet_id, 'DEBIT', p_amount, v_source_balance, 'Atomic wallet transfer debit'),
         (v_tx_id, p_target_wallet_id, 'CREDIT', p_amount, v_target_balance, 'Atomic wallet transfer credit');

  SELECT ts.max_supply INTO v_max_supply FROM wallet.token_supply AS ts WHERE ts.id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOKEN_SUPPLY_MASTER_MISSING'; END IF;
  SELECT COALESCE(SUM(w.balance::numeric + COALESCE(w.reserved_balance, 0)::numeric), 0)
    INTO v_total_supply FROM wallet.wallets AS w;
  IF v_total_supply <> v_max_supply THEN
    RAISE EXCEPTION 'TOKEN_SUPPLY_INVARIANT_VIOLATED: total %, expected %', v_total_supply, v_max_supply;
  END IF;
  RETURN v_tx_id;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM wallet.wallet_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM p_source_wallet_id
       OR v_existing.target_wallet_id IS DISTINCT FROM p_target_wallet_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.type IS DISTINCT FROM p_type
       OR COALESCE(v_existing.metadata, '{}'::jsonb) IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;
  RAISE;
END;
$function$;
