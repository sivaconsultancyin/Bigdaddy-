-- Reconcile Aviator pool reservations against outstanding PENDING bets.
-- Safe to rerun: this derives reserved_balance from persisted liabilities rather than
-- blindly subtracting a hard-coded amount. It does not alter wallet balances or bets.
BEGIN;

DO $reconcile$
DECLARE
  v_pool_wallet_id uuid;
  v_pool_balance bigint;
  v_expected_reserved bigint;
BEGIN
  SELECT pool_wallet_id
    INTO v_pool_wallet_id
    FROM public.games
   WHERE code = 'aviator'
   FOR UPDATE;

  IF v_pool_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile Aviator pool: game or pool wallet is missing';
  END IF;

  SELECT balance
    INTO v_pool_balance
    FROM public.wallets
   WHERE id = v_pool_wallet_id
   FOR UPDATE;

  IF v_pool_balance IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile Aviator pool: pool wallet is missing';
  END IF;

  SELECT COALESCE(
           SUM(CEIL(gb.bet_amount::numeric * COALESCE(gb.auto_cashout, 50))),
           0
         )::bigint
    INTO v_expected_reserved
    FROM public.game_bets gb
    JOIN public.game_rounds gr ON gr.id = gb.round_id
   WHERE gr.game_code = 'aviator'
     AND gb.status = 'PENDING';

  IF v_expected_reserved > v_pool_balance THEN
    RAISE EXCEPTION
      'Aviator reservation reconciliation aborted: outstanding liability % exceeds pool balance %',
      v_expected_reserved, v_pool_balance;
  END IF;

  UPDATE public.wallets
     SET reserved_balance = v_expected_reserved,
         updated_at = now()
   WHERE id = v_pool_wallet_id
     AND reserved_balance IS DISTINCT FROM v_expected_reserved;

  RAISE NOTICE
    'Aviator pool reservation reconciled: wallet %, reserved balance now %',
    v_pool_wallet_id, v_expected_reserved;
END
$reconcile$;

COMMIT;
