-- Correct the final Crash settlement functions after the liability-reservation
-- and game-pool stake-recycling migrations.
-- Keep reserved_balance equal to outstanding maximum payout liabilities and use
-- CEIL consistently so fractional auto-cashout multipliers cannot under-reserve.
BEGIN;

CREATE OR REPLACE FUNCTION public.place_crash_bet_atomic(
  p_user_id uuid, p_round_id uuid, p_amount bigint, p_idempotency_key text,
  p_auto_cashout numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_bet_id uuid;
  v_existing_bet public.game_bets%ROWTYPE;
  v_round public.game_rounds%ROWTYPE;
  v_player_wallet uuid;
  v_escrow_wallet uuid;
  v_pool_wallet uuid;
  v_pool_balance bigint;
  v_pool_reserved bigint;
  v_max_bet bigint;
  v_min_bet bigint;
  v_liability bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'; END IF;
  IF p_auto_cashout IS NOT NULL AND (p_auto_cashout < 1.01 OR p_auto_cashout > 50) THEN
    RAISE EXCEPTION 'INVALID_AUTO_CASHOUT';
  END IF;

  SELECT * INTO v_existing_bet FROM public.game_bets WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_bet.user_id IS DISTINCT FROM p_user_id
       OR v_existing_bet.round_id IS DISTINCT FROM p_round_id
       OR v_existing_bet.bet_amount IS DISTINCT FROM p_amount
       OR v_existing_bet.auto_cashout IS DISTINCT FROM p_auto_cashout THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE';
    END IF;
    RETURN v_existing_bet.id;
  END IF;

  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.game_code <> 'aviator' THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'WAITING' THEN RAISE EXCEPTION 'BETTING_CLOSED'; END IF;

  SELECT min_bet, max_bet, pool_wallet_id
    INTO v_min_bet, v_max_bet, v_pool_wallet
    FROM public.games WHERE code = 'aviator' AND status = 'ACTIVE';
  IF v_pool_wallet IS NULL THEN RAISE EXCEPTION 'CRASH_GAME_NOT_ACTIVE'; END IF;
  IF p_amount < v_min_bet OR p_amount > v_max_bet THEN RAISE EXCEPTION 'BET_OUT_OF_RANGE'; END IF;

  SELECT id INTO v_player_wallet FROM public.wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
  SELECT id INTO v_escrow_wallet FROM public.wallets WHERE wallet_type = 'ESCROW' LIMIT 1;
  SELECT balance, reserved_balance INTO v_pool_balance, v_pool_reserved
    FROM public.wallets WHERE id = v_pool_wallet FOR UPDATE;
  IF v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  v_liability := CEIL(p_amount::numeric * COALESCE(p_auto_cashout, 50))::bigint;
  IF v_pool_balance - COALESCE(v_pool_reserved, 0) < v_liability THEN
    RAISE EXCEPTION 'GAME_POOL_INSUFFICIENT';
  END IF;

  PERFORM public.wallet_transfer_atomic(
    'BET_LOCK_' || p_idempotency_key, 'BET_ESCROW_LOCK', p_amount,
    v_player_wallet, v_escrow_wallet,
    jsonb_build_object('roundId', p_round_id, 'userId', p_user_id)
  );

  INSERT INTO public.game_bets(round_id, user_id, bet_amount, auto_cashout, status, payout_amount, idempotency_key)
  VALUES (p_round_id, p_user_id, p_amount, p_auto_cashout, 'PENDING', 0, p_idempotency_key)
  RETURNING id INTO v_bet_id;

  UPDATE public.wallets SET reserved_balance = reserved_balance + v_liability, updated_at = now()
    WHERE id = v_pool_wallet;
  RETURN v_bet_id;
END $$;

CREATE OR REPLACE FUNCTION public.cashout_crash_bet_atomic(
  p_user_id uuid, p_bet_id uuid, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_round_id uuid;
  v_bet public.game_bets%ROWTYPE;
  v_round public.game_rounds%ROWTYPE;
  v_pool_wallet uuid;
  v_player_wallet uuid;
  v_escrow_wallet uuid;
  v_multiplier numeric(10,2);
  v_payout bigint;
  v_liability bigint;
  v_payout_tx uuid;
BEGIN
  SELECT round_id INTO v_round_id FROM public.game_bets
    WHERE id = p_bet_id AND user_id = p_user_id;
  IF v_round_id IS NULL THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;

  -- Match the round-before-bet lock order used by round settlement.
  SELECT * INTO v_round FROM public.game_rounds WHERE id = v_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  SELECT * INTO v_bet FROM public.game_bets
    WHERE id = p_bet_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;

  IF v_bet.status = 'WON' THEN
    RETURN jsonb_build_object('betId', v_bet.id, 'status', v_bet.status,
      'payoutAmount', v_bet.payout_amount, 'cashoutMultiplier', v_bet.cashed_out_at);
  END IF;
  IF v_bet.status <> 'PENDING' THEN RAISE EXCEPTION 'BET_ALREADY_SETTLED'; END IF;
  IF v_round.status <> 'RUNNING' THEN RAISE EXCEPTION 'ROUND_NOT_RUNNING'; END IF;

  v_multiplier := floor(exp(0.06 * power(extract(epoch from (now() - v_round.started_at)), 1.15)) * 100) / 100;
  IF v_multiplier < 1 THEN v_multiplier := 1; END IF;
  IF v_round.crash_multiplier IS NOT NULL AND v_multiplier >= v_round.crash_multiplier THEN
    RAISE EXCEPTION 'ROUND_ALREADY_CRASHED';
  END IF;
  IF v_bet.auto_cashout IS NOT NULL AND v_multiplier > v_bet.auto_cashout THEN
    v_multiplier := v_bet.auto_cashout;
  END IF;

  v_payout := floor(v_bet.bet_amount * v_multiplier)::bigint;
  v_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
  SELECT pool_wallet_id INTO v_pool_wallet FROM public.games WHERE code = v_round.game_code;
  SELECT id INTO v_player_wallet FROM public.wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
  SELECT id INTO v_escrow_wallet FROM public.wallets WHERE wallet_type = 'ESCROW' LIMIT 1;
  IF v_pool_wallet IS NULL OR v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  v_payout_tx := public.wallet_transfer_atomic(
    'BET_PAYOUT_' || p_idempotency_key, 'BET_WIN_PAYOUT', v_payout,
    v_pool_wallet, v_player_wallet,
    jsonb_build_object('betId', v_bet.id, 'roundId', v_round.id, 'multiplier', v_multiplier)
  );

  PERFORM public.wallet_transfer_atomic(
    'BET_STAKE_' || p_idempotency_key, 'BET_LOSS_GAME_POOL', v_bet.bet_amount,
    v_escrow_wallet, v_pool_wallet,
    jsonb_build_object('betId', v_bet.id, 'roundId', v_round.id,
      'settlement', 'cashout_stake_recycled_to_game_pool')
  );

  UPDATE public.wallets SET reserved_balance = reserved_balance - v_liability, updated_at = now()
    WHERE id = v_pool_wallet AND reserved_balance >= v_liability;
  IF NOT FOUND THEN RAISE EXCEPTION 'GAME_POOL_RESERVATION_INVARIANT_FAILED'; END IF;

  UPDATE public.game_bets SET status = 'WON', cashed_out_at = v_multiplier, payout_amount = v_payout
    WHERE id = v_bet.id;
  INSERT INTO public.game_settlements(bet_id, round_id, transaction_id, payout_multiplier, net_win_amount)
  VALUES (v_bet.id, v_round.id, v_payout_tx, v_multiplier, v_payout - v_bet.bet_amount)
  ON CONFLICT (bet_id) DO NOTHING;

  RETURN jsonb_build_object('betId', v_bet.id, 'status', 'WON',
    'payoutAmount', v_payout, 'cashoutMultiplier', v_multiplier, 'transactionId', v_payout_tx);
END $$;

CREATE OR REPLACE FUNCTION public.settle_crash_round_atomic(p_round_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_round public.game_rounds%ROWTYPE;
  v_bet public.game_bets%ROWTYPE;
  v_escrow_wallet uuid;
  v_pool_wallet uuid;
  v_liability bigint;
  v_tx uuid;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status = 'SETTLED' THEN RETURN 0; END IF;
  IF v_round.status <> 'CRASHED' THEN RAISE EXCEPTION 'ROUND_NOT_CRASHED'; END IF;

  SELECT id INTO v_escrow_wallet FROM public.wallets WHERE wallet_type = 'ESCROW' LIMIT 1;
  SELECT pool_wallet_id INTO v_pool_wallet FROM public.games WHERE code = v_round.game_code;
  IF v_escrow_wallet IS NULL OR v_pool_wallet IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  FOR v_bet IN
    SELECT * FROM public.game_bets WHERE round_id = p_round_id AND status = 'PENDING' FOR UPDATE
  LOOP
    v_tx := public.wallet_transfer_atomic(
      'BET_LOSS_' || v_bet.id::text, 'BET_LOSS_GAME_POOL', v_bet.bet_amount,
      v_escrow_wallet, v_pool_wallet,
      jsonb_build_object('betId', v_bet.id, 'roundId', p_round_id,
        'crashMultiplier', v_round.crash_multiplier, 'settlement', 'crash_loss_to_game_pool')
    );

    v_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
    UPDATE public.wallets SET reserved_balance = reserved_balance - v_liability, updated_at = now()
      WHERE id = v_pool_wallet AND reserved_balance >= v_liability;
    IF NOT FOUND THEN RAISE EXCEPTION 'GAME_POOL_RESERVATION_INVARIANT_FAILED'; END IF;

    UPDATE public.game_bets SET status = 'LOST', payout_amount = 0 WHERE id = v_bet.id;
    INSERT INTO public.game_settlements(bet_id, round_id, transaction_id, payout_multiplier, net_win_amount)
    VALUES (v_bet.id, p_round_id, v_tx, COALESCE(v_round.crash_multiplier, 1), -v_bet.bet_amount)
    ON CONFLICT (bet_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.game_rounds SET status = 'SETTLED', ended_at = COALESCE(ended_at, now())
    WHERE id = p_round_id;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.place_crash_bet_atomic(uuid,uuid,bigint,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cashout_crash_bet_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_crash_round_atomic(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
