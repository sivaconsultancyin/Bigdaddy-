-- Durable wallet and Crash-game transaction primitives. Additive migration only.
ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS idempotency_key varchar;
CREATE UNIQUE INDEX IF NOT EXISTS game_bets_idempotency_key_uidx ON public.game_bets(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS game_rounds_game_code_round_number_uidx ON public.game_rounds(game_code, round_number);

CREATE OR REPLACE FUNCTION public.wallet_transfer_atomic(
  p_idempotency_key text, p_type public.transaction_type_enum, p_amount bigint,
  p_source_wallet_id uuid, p_target_wallet_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing_id uuid; v_source_balance bigint; v_target_balance bigint; v_tx_id uuid;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;
  IF p_source_wallet_id IS NULL OR p_target_wallet_id IS NULL OR p_source_wallet_id=p_target_wallet_id THEN RAISE EXCEPTION 'INVALID_WALLET_PAIR'; END IF;
  SELECT id INTO v_existing_id FROM public.wallet_transactions WHERE idempotency_key=p_idempotency_key;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;
  PERFORM id FROM public.wallets WHERE id IN (p_source_wallet_id,p_target_wallet_id) ORDER BY id FOR UPDATE;
  SELECT balance INTO v_source_balance FROM public.wallets WHERE id=p_source_wallet_id;
  SELECT balance INTO v_target_balance FROM public.wallets WHERE id=p_target_wallet_id;
  IF v_source_balance IS NULL OR v_target_balance IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
  IF v_source_balance < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;
  INSERT INTO public.wallet_transactions(idempotency_key,type,amount,source_wallet_id,target_wallet_id,metadata)
  VALUES(p_idempotency_key,p_type,p_amount,p_source_wallet_id,p_target_wallet_id,COALESCE(p_metadata,'{}'::jsonb)) RETURNING id INTO v_tx_id;
  UPDATE public.wallets SET balance=balance-p_amount,updated_at=now() WHERE id=p_source_wallet_id RETURNING balance INTO v_source_balance;
  UPDATE public.wallets SET balance=balance+p_amount,updated_at=now() WHERE id=p_target_wallet_id RETURNING balance INTO v_target_balance;
  INSERT INTO public.ledger_entries(transaction_id,wallet_id,direction,amount,balance_after,description)
  VALUES(v_tx_id,p_source_wallet_id,'DEBIT',p_amount,v_source_balance,'Atomic wallet transfer debit'),
        (v_tx_id,p_target_wallet_id,'CREDIT',p_amount,v_target_balance,'Atomic wallet transfer credit');
  RETURN v_tx_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_existing_id FROM public.wallet_transactions WHERE idempotency_key=p_idempotency_key;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;
  RAISE;
END $$;

CREATE OR REPLACE FUNCTION public.place_crash_bet_atomic(
  p_user_id uuid,p_round_id uuid,p_amount bigint,p_idempotency_key text,p_auto_cashout numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_bet_id uuid; v_round public.game_rounds%ROWTYPE; v_player_wallet uuid; v_escrow_wallet uuid;
  v_pool_wallet uuid; v_pool_balance bigint; v_max_bet bigint; v_min_bet bigint; v_liability bigint;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key))<8 THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'; END IF;
  IF p_auto_cashout IS NOT NULL AND (p_auto_cashout<1.01 OR p_auto_cashout>50) THEN RAISE EXCEPTION 'INVALID_AUTO_CASHOUT'; END IF;
  SELECT id INTO v_bet_id FROM public.game_bets WHERE idempotency_key=p_idempotency_key;
  IF v_bet_id IS NOT NULL THEN RETURN v_bet_id; END IF;
  SELECT * INTO v_round FROM public.game_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.game_code<>'aviator' THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status<>'WAITING' THEN RAISE EXCEPTION 'BETTING_CLOSED'; END IF;
  SELECT min_bet,max_bet,pool_wallet_id INTO v_min_bet,v_max_bet,v_pool_wallet FROM public.games WHERE code='aviator' AND status='ACTIVE';
  IF v_pool_wallet IS NULL THEN RAISE EXCEPTION 'CRASH_GAME_NOT_ACTIVE'; END IF;
  IF p_amount<v_min_bet OR p_amount>v_max_bet THEN RAISE EXCEPTION 'BET_OUT_OF_RANGE'; END IF;
  SELECT id INTO v_player_wallet FROM public.wallets WHERE user_id=p_user_id AND wallet_type='PLAYER';
  SELECT id INTO v_escrow_wallet FROM public.wallets WHERE wallet_type='ESCROW' LIMIT 1;
  SELECT balance INTO v_pool_balance FROM public.wallets WHERE id=v_pool_wallet FOR UPDATE;
  IF v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
  v_liability:=p_amount*COALESCE(p_auto_cashout,50)::bigint;
  IF v_pool_balance<v_liability THEN RAISE EXCEPTION 'GAME_POOL_INSUFFICIENT'; END IF;
  PERFORM public.wallet_transfer_atomic('BET_LOCK_'||p_idempotency_key,'BET_ESCROW_LOCK',p_amount,v_player_wallet,v_escrow_wallet,jsonb_build_object('roundId',p_round_id,'userId',p_user_id));
  INSERT INTO public.game_bets(round_id,user_id,bet_amount,auto_cashout,status,payout_amount,idempotency_key)
  VALUES(p_round_id,p_user_id,p_amount,p_auto_cashout,'PENDING',0,p_idempotency_key) RETURNING id INTO v_bet_id;
  RETURN v_bet_id;
END $$;

CREATE OR REPLACE FUNCTION public.cashout_crash_bet_atomic(p_user_id uuid,p_bet_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_bet public.game_bets%ROWTYPE; v_round public.game_rounds%ROWTYPE; v_pool_wallet uuid;
  v_player_wallet uuid; v_escrow_wallet uuid; v_treasury_wallet uuid; v_multiplier numeric(10,2); v_payout bigint; v_payout_tx uuid;
BEGIN
  SELECT * INTO v_bet FROM public.game_bets WHERE id=p_bet_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_NOT_FOUND'; END IF;
  IF v_bet.status='WON' THEN RETURN jsonb_build_object('betId',v_bet.id,'status',v_bet.status,'payoutAmount',v_bet.payout_amount,'cashoutMultiplier',v_bet.cashed_out_at); END IF;
  IF v_bet.status<>'PENDING' THEN RAISE EXCEPTION 'BET_ALREADY_SETTLED'; END IF;
  SELECT * INTO v_round FROM public.game_rounds WHERE id=v_bet.round_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.settle_crash_round_atomic(p_round_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_round public.game_rounds%ROWTYPE; v_bet public.game_bets%ROWTYPE; v_escrow_wallet uuid;
  v_treasury_wallet uuid; v_tx uuid; v_count integer:=0;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status='SETTLED' THEN RETURN 0; END IF;
  IF v_round.status<>'CRASHED' THEN RAISE EXCEPTION 'ROUND_NOT_CRASHED'; END IF;
  SELECT id INTO v_escrow_wallet FROM public.wallets WHERE wallet_type='ESCROW' LIMIT 1;
  SELECT id INTO v_treasury_wallet FROM public.wallets WHERE wallet_type='TREASURY' LIMIT 1;
  FOR v_bet IN SELECT * FROM public.game_bets WHERE round_id=p_round_id AND status='PENDING' FOR UPDATE LOOP
    v_tx:=public.wallet_transfer_atomic('BET_LOSS_'||v_bet.id::text,'BET_LOSS_TREASURY',v_bet.bet_amount,v_escrow_wallet,v_treasury_wallet,jsonb_build_object('betId',v_bet.id,'roundId',p_round_id,'crashMultiplier',v_round.crash_multiplier));
    UPDATE public.game_bets SET status='LOST',payout_amount=0 WHERE id=v_bet.id;
    INSERT INTO public.game_settlements(bet_id,round_id,transaction_id,payout_multiplier,net_win_amount)
    VALUES(v_bet.id,p_round_id,v_tx,COALESCE(v_round.crash_multiplier,1),-v_bet.bet_amount) ON CONFLICT(bet_id) DO NOTHING;
    v_count:=v_count+1;
  END LOOP;
  UPDATE public.game_rounds SET status='SETTLED',ended_at=COALESCE(ended_at,now()) WHERE id=p_round_id;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.wallet_transfer_atomic(text,public.transaction_type_enum,bigint,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.place_crash_bet_atomic(uuid,uuid,bigint,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cashout_crash_bet_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_crash_round_atomic(uuid) FROM PUBLIC,anon,authenticated;
