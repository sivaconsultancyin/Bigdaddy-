-- Lock Crash round before bet to use the same order as round settlement.
CREATE OR REPLACE FUNCTION public.cashout_crash_bet_atomic(p_user_id uuid,p_bet_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_round_id uuid; v_bet public.game_bets%ROWTYPE; v_round public.game_rounds%ROWTYPE;
  v_pool_wallet uuid; v_player_wallet uuid; v_escrow_wallet uuid; v_treasury_wallet uuid;
  v_multiplier numeric(10,2); v_payout bigint; v_payout_tx uuid;
BEGIN
  SELECT round_id INTO v_round_id FROM public.game_bets WHERE id=p_bet_id AND user_id=p_user_id;
  IF v_round_id IS NULL THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;
  SELECT * INTO v_round FROM public.game_rounds WHERE id=v_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  SELECT * INTO v_bet FROM public.game_bets WHERE id=p_bet_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;
  IF v_bet.status='WON' THEN RETURN jsonb_build_object('betId',v_bet.id,'status',v_bet.status,'payoutAmount',v_bet.payout_amount,'cashoutMultiplier',v_bet.cashed_out_at); END IF;
  IF v_bet.status<>'PENDING' THEN RAISE EXCEPTION 'BET_ALREADY_SETTLED'; END IF;
  IF v_round.status<>'RUNNING' THEN RAISE EXCEPTION 'ROUND_NOT_RUNNING'; END IF;
  v_multiplier:=floor(exp(0.06*power(extract(epoch from (now()-v_round.started_at)),1.15))*100)/100;
  IF v_multiplier<1 THEN v_multiplier:=1; END IF;
  IF v_round.crash_multiplier IS NOT NULL AND v_multiplier>=v_round.crash_multiplier THEN RAISE EXCEPTION 'ROUND_ALREADY_CRASHED'; END IF;
  IF v_bet.auto_cashout IS NOT NULL AND v_multiplier>v_bet.auto_cashout THEN v_multiplier:=v_bet.auto_cashout; END IF;
  v_payout:=floor(v_bet.bet_amount*v_multiplier)::bigint;
  SELECT pool_wallet_id INTO v_pool_wallet FROM public.games WHERE code=v_round.game_code;
  SELECT id INTO v_player_wallet FROM public.wallets WHERE user_id=p_user_id AND wallet_type='PLAYER';
  SELECT id INTO v_escrow_wallet FROM public.wallets WHERE wallet_type='ESCROW' LIMIT 1;
  SELECT id INTO v_treasury_wallet FROM public.wallets WHERE wallet_type='TREASURY' LIMIT 1;
  IF v_pool_wallet IS NULL OR v_player_wallet IS NULL OR v_escrow_wallet IS NULL OR v_treasury_wallet IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
  v_payout_tx:=public.wallet_transfer_atomic('BET_PAYOUT_'||p_idempotency_key,'BET_WIN_PAYOUT',v_payout,v_pool_wallet,v_player_wallet,jsonb_build_object('betId',v_bet.id,'roundId',v_round.id,'multiplier',v_multiplier));
  PERFORM public.wallet_transfer_atomic('BET_STAKE_'||p_idempotency_key,'BET_LOSS_TREASURY',v_bet.bet_amount,v_escrow_wallet,v_treasury_wallet,jsonb_build_object('betId',v_bet.id,'roundId',v_round.id,'settlement','cashout_stake'));
  UPDATE public.game_bets SET status='WON',cashed_out_at=v_multiplier,payout_amount=v_payout WHERE id=v_bet.id;
  INSERT INTO public.game_settlements(bet_id,round_id,transaction_id,payout_multiplier,net_win_amount)
  VALUES(v_bet.id,v_round.id,v_payout_tx,v_multiplier,v_payout-v_bet.bet_amount) ON CONFLICT(bet_id) DO NOTHING;
  RETURN jsonb_build_object('betId',v_bet.id,'status','WON','payoutAmount',v_payout,'cashoutMultiplier',v_multiplier,'transactionId',v_payout_tx);
END $$;
