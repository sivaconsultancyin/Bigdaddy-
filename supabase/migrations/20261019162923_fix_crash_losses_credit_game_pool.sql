-- A crashed, uncashed bet must flow from escrow to the Aviator game pool,
-- not to the Owner treasury. The function is idempotent per bet.
CREATE OR REPLACE FUNCTION public.settle_crash_round_atomic(p_round_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_round public.game_rounds%ROWTYPE;
  v_bet public.game_bets%ROWTYPE;
  v_escrow_wallet uuid;
  v_pool_wallet uuid;
  v_tx uuid;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_round
  FROM public.game_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status = 'SETTLED' THEN RETURN 0; END IF;
  IF v_round.status <> 'CRASHED' THEN RAISE EXCEPTION 'ROUND_NOT_CRASHED'; END IF;

  SELECT id INTO v_escrow_wallet
  FROM public.wallets WHERE wallet_type = 'ESCROW' LIMIT 1;
  SELECT pool_wallet_id INTO v_pool_wallet
  FROM public.games WHERE code = v_round.game_code;

  IF v_escrow_wallet IS NULL OR v_pool_wallet IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  FOR v_bet IN
    SELECT * FROM public.game_bets
    WHERE round_id = p_round_id AND status = 'PENDING'
    FOR UPDATE
  LOOP
    v_tx := public.wallet_transfer_atomic(
      'BET_LOSS_' || v_bet.id::text,
      'BET_LOSS_GAME_POOL',
      v_bet.bet_amount,
      v_escrow_wallet,
      v_pool_wallet,
      jsonb_build_object(
        'betId', v_bet.id,
        'roundId', p_round_id,
        'crashMultiplier', v_round.crash_multiplier,
        'settlement', 'crash_loss_to_game_pool'
      )
    );

    UPDATE public.game_bets
    SET status = 'LOST', payout_amount = 0
    WHERE id = v_bet.id;

    INSERT INTO public.game_settlements(
      bet_id, round_id, transaction_id, payout_multiplier, net_win_amount
    )
    VALUES (
      v_bet.id, p_round_id, v_tx,
      COALESCE(v_round.crash_multiplier, 1), -v_bet.bet_amount
    )
    ON CONFLICT (bet_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.game_rounds
  SET status = 'SETTLED', ended_at = COALESCE(ended_at, now())
  WHERE id = p_round_id;

  RETURN v_count;
END $$;