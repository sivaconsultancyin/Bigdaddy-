-- Preserve the concurrent round-share lock without cashing out at a stale
-- transaction-start multiplier after waiting for the shared game-pool wallet.
DO $migration$
DECLARE
  v_signature regprocedure := 'aviator.cashout_crash_bet_atomic(uuid,uuid,text)'::regprocedure;
  v_def text;
  v_decl_old text := '  v_payout_tx uuid;';
  v_decl_new text := '  v_payout_tx uuid;
  v_locked_wallets integer;';
  v_old text := $old$
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
  SELECT pool_wallet_id INTO v_pool_wallet FROM platform.games WHERE code = v_round.game_code;
  SELECT id INTO v_player_wallet FROM wallet.wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
  SELECT id INTO v_escrow_wallet FROM wallet.wallets WHERE wallet_type = 'ESCROW' ORDER BY id LIMIT 1;
  IF v_pool_wallet IS NULL OR v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
$old$;
  v_new text := $new$
  v_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
  SELECT pool_wallet_id INTO v_pool_wallet FROM platform.games WHERE code = v_round.game_code;
  SELECT id INTO v_player_wallet FROM wallet.wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
  SELECT id INTO v_escrow_wallet FROM wallet.wallets WHERE wallet_type = 'ESCROW' ORDER BY id LIMIT 1;
  IF v_pool_wallet IS NULL OR v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  -- Lock every wallet touched by cashout in the same global ID order as
  -- wallet_transfer_atomic before sampling the multiplier. This prevents a
  -- pool-wallet queue from using the transaction-start timestamp after crash.
  PERFORM w.id FROM wallet.wallets AS w
  WHERE w.id IN (v_pool_wallet, v_player_wallet, v_escrow_wallet)
  ORDER BY w.id FOR UPDATE;
  GET DIAGNOSTICS v_locked_wallets = ROW_COUNT;
  IF v_locked_wallets <> 3 THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  v_multiplier := floor(exp(0.06 * power(extract(epoch from (clock_timestamp() - v_round.started_at)), 1.15)) * 100) / 100;
  IF v_multiplier < 1 THEN v_multiplier := 1; END IF;
  IF v_round.crash_multiplier IS NOT NULL AND v_multiplier >= v_round.crash_multiplier THEN
    RAISE EXCEPTION 'ROUND_ALREADY_CRASHED';
  END IF;
  IF v_bet.auto_cashout IS NOT NULL AND v_multiplier > v_bet.auto_cashout THEN
    v_multiplier := v_bet.auto_cashout;
  END IF;
  v_payout := floor(v_bet.bet_amount * v_multiplier)::bigint;
$new$;
BEGIN
  v_def := pg_get_functiondef(v_signature);
  IF v_def IS NULL THEN RAISE EXCEPTION 'AVIATOR_CASHOUT_FUNCTION_NOT_FOUND'; END IF;

  IF position('v_locked_wallets integer;' IN v_def) > 0
     AND position('clock_timestamp() - v_round.started_at' IN v_def) > 0
     AND position('WHERE id = v_round_id FOR SHARE;' IN v_def) > 0 THEN
    RAISE NOTICE 'Aviator cashout timing hardening already installed';
    RETURN;
  END IF;

  IF position(v_decl_old IN v_def) = 0 THEN RAISE EXCEPTION 'EXPECTED_CASHOUT_DECLARATION_NOT_FOUND'; END IF;
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'EXPECTED_CASHOUT_MULTIPLIER_BLOCK_NOT_FOUND'; END IF;
  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'EXPECTED_EXACTLY_ONE_CASHOUT_MULTIPLIER_BLOCK';
  END IF;

  v_def := replace(v_def, v_decl_old, v_decl_new);
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
