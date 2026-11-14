-- Fix token supply invariant: reserved_balance is a subset/liability of wallet
-- funds, not separately minted tokens. Count spendable + reserved amounts only
-- once by summing wallet balances.
DO $migration$
DECLARE
  v_definition text;
  v_old text := 'SUM(w.balance::numeric + COALESCE(w.reserved_balance, 0)::numeric)';
  v_new text := 'SUM(w.balance::numeric)';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'wallet'
    AND p.proname = 'wallet_transfer_atomic'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_idempotency_key text, p_type transaction_type_enum, p_amount bigint, p_source_wallet_id uuid, p_target_wallet_id uuid, p_metadata jsonb';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'wallet.wallet_transfer_atomic function not found';
  END IF;

  IF position(v_old IN v_definition) = 0 THEN
    IF position(v_new IN v_definition) > 0 THEN
      RAISE NOTICE 'Token supply invariant already uses balance only';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Expected token supply expression not found; refusing to modify function';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$migration$;
