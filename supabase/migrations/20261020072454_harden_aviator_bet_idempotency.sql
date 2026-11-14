-- Make Aviator bet placement idempotent even when concurrent requests race.
-- The round row lock serializes bet placement against WAITING -> RUNNING transitions.
BEGIN;

CREATE OR REPLACE FUNCTION public.place_crash_bet_atomic(
  p_user_id uuid,
  p_round_id uuid,
  p_amount bigint,
  p_idempotency_key text,
  p_auto_cashout numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_bet public.game_bets%ROWTYPE;
  v_round public.game_rounds%ROWTYPE;
  v_player_wallet uuid;
  v_escrow_wallet uuid;
  v_pool_wallet uuid;
  v_pool_balance bigint;
  v_max_bet bigint;
  v_min_bet bigint;
  v_liability bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF p_auto_cashout IS NOT NULL AND (p_auto_cashout < 1.01 OR p_auto_cashout > 50) THEN
    RAISE EXCEPTION 'INVALID_AUTO_CASHOUT';
  END IF;

  -- Fast replay path. Never let a key silently alias another bet request.
  SELECT * INTO v_bet FROM public.game_bets WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_bet.user_id IS DISTINCT FROM p_user_id
       OR v_bet.round_id IS DISTINCT FROM p_round_id
       OR v_bet.bet_amount IS DISTINCT FROM p_amount
       OR v_bet.auto_cashout IS DISTINCT FROM p_auto_cashout THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE';
    END IF;
    RETURN v_bet.id;
  END IF;

  -- This row lock is shared with the round engine's WAITING -> RUNNING update.
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.game_code <> 'aviator' THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  -- Recheck after acquiring the round lock: concurrent requests may have
  -- passed the fast replay check before the first request inserted its bet.
  SELECT * INTO v_bet FROM public.game_bets WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_bet.user_id IS DISTINCT FROM p_user_id
       OR v_bet.round_id IS DISTINCT FROM p_round_id
       OR v_bet.bet_amount IS DISTINCT FROM p_amount
       OR v_bet.auto_cashout IS DISTINCT FROM p_auto_cashout THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE';
    END IF;
    RETURN v_bet.id;
  END IF;

  IF v_round.status <> 'WAITING' THEN
    RAISE EXCEPTION 'BETTING_CLOSED';
  END IF;

  SELECT min_bet, max_bet, pool_wallet_id
    INTO v_min_bet, v_max_bet, v_pool_wallet
    FROM public.games WHERE code = 'aviator' AND status = 'ACTIVE';
  IF v_pool_wallet IS NULL THEN
    RAISE EXCEPTION 'CRASH_GAME_NOT_ACTIVE';
  END IF;
  IF p_amount < v_min_bet OR p_amount > v_max_bet THEN
    RAISE EXCEPTION 'BET_OUT_OF_RANGE';
  END IF;

  SELECT id INTO v_player_wallet
    FROM public.wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
  SELECT id INTO v_escrow_wallet
    FROM public.wallets WHERE wallet_type = 'ESCROW' ORDER BY id LIMIT 1;
  SELECT balance INTO v_pool_balance
    FROM public.wallets WHERE id = v_pool_wallet FOR UPDATE;

  IF v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;
  v_liability := p_amount * COALESCE(p_auto_cashout, 50)::bigint;
  IF v_pool_balance < v_liability THEN
    RAISE EXCEPTION 'GAME_POOL_INSUFFICIENT';
  END IF;

  PERFORM public.wallet_transfer_atomic(
    'BET_LOCK_' || p_idempotency_key,
    'BET_ESCROW_LOCK',
    p_amount,
    v_player_wallet,
    v_escrow_wallet,
    jsonb_build_object('roundId', p_round_id, 'userId', p_user_id)
  );

  INSERT INTO public.game_bets(round_id,user_id,bet_amount,auto_cashout,status,payout_amount,idempotency_key)
  VALUES(p_round_id,p_user_id,p_amount,p_auto_cashout,'PENDING',0,p_idempotency_key)
  RETURNING * INTO v_bet;

  RETURN v_bet.id;
END
$$;

REVOKE ALL ON FUNCTION public.place_crash_bet_atomic(uuid,uuid,bigint,text,numeric)
  FROM PUBLIC, anon, authenticated;

COMMIT;
