
CREATE OR REPLACE FUNCTION aviator.refund_stale_waiting_round_pending_bets(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_round aviator.game_rounds%ROWTYPE;
  v_pool_wallet uuid;
  v_escrow_wallet uuid;
  v_total_liability bigint := 0;
  v_refund_total bigint := 0;
  v_count integer := 0;
  v_bet record;
  v_lock_tx wallet.wallet_transactions%ROWTYPE;
  v_refund_tx uuid;
  v_player_wallet uuid;
  v_expected_liability bigint;
  v_locked_wallets integer;
  v_expected_wallet_locks integer;
BEGIN
  IF p_round_id IS NULL THEN RAISE EXCEPTION 'ROUND_ID_REQUIRED'; END IF;
  SELECT * INTO v_round FROM aviator.game_rounds
  WHERE id = p_round_id AND game_code = 'aviator' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AVIATOR_ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'WAITING' THEN RAISE EXCEPTION 'ROUND_NOT_WAITING: %', v_round.status; END IF;
  IF v_round.started_at >= now() - interval '2 minutes' THEN RAISE EXCEPTION 'ROUND_NOT_STALE'; END IF;
  IF v_round.revealed_server_seed IS NOT NULL OR v_round.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_HAS_STARTED_OR_ENDED';
  END IF;

  SELECT pool_wallet_id INTO v_pool_wallet FROM platform.games
  WHERE code = 'aviator' AND status = 'ACTIVE';
  IF v_pool_wallet IS NULL THEN RAISE EXCEPTION 'AVIATOR_POOL_NOT_FOUND'; END IF;
  SELECT id INTO v_escrow_wallet FROM wallet.wallets
  WHERE wallet_type = 'ESCROW' ORDER BY id LIMIT 1;
  IF v_escrow_wallet IS NULL THEN RAISE EXCEPTION 'ESCROW_WALLET_NOT_FOUND'; END IF;

  FOR v_bet IN
    SELECT b.* FROM aviator.game_bets b
    WHERE b.round_id = p_round_id AND b.status = 'PENDING'
    ORDER BY b.id FOR UPDATE
  LOOP
    SELECT * INTO v_lock_tx FROM wallet.wallet_transactions
    WHERE idempotency_key = 'BET_LOCK_' || v_bet.idempotency_key;
    IF NOT FOUND OR v_lock_tx.type <> 'BET_ESCROW_LOCK'
       OR v_lock_tx.amount <> v_bet.bet_amount
       OR v_lock_tx.target_wallet_id <> v_escrow_wallet
       OR v_lock_tx.source_wallet_id IS NULL THEN
      RAISE EXCEPTION 'BET_ESCROW_LOCK_MISMATCH: %', v_bet.id;
    END IF;
    SELECT id INTO v_player_wallet FROM wallet.wallets
    WHERE id = v_lock_tx.source_wallet_id AND user_id = v_bet.user_id
      AND wallet_type = 'PLAYER';
    IF v_player_wallet IS NULL THEN RAISE EXCEPTION 'PLAYER_WALLET_MISMATCH: %', v_bet.id; END IF;
    IF EXISTS (SELECT 1 FROM aviator.game_settlements s WHERE s.bet_id = v_bet.id) THEN
      RAISE EXCEPTION 'BET_ALREADY_HAS_SETTLEMENT: %', v_bet.id;
    END IF;
    v_expected_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
    v_total_liability := v_total_liability + v_expected_liability;
    v_refund_total := v_refund_total + v_bet.bet_amount;
  END LOOP;

  IF v_total_liability = 0 THEN
    RETURN jsonb_build_object('roundId', p_round_id, 'refundedBets', 0, 'refundAmount', 0, 'releasedLiability', 0);
  END IF;

  PERFORM w.id FROM wallet.wallets w
  WHERE w.id = v_pool_wallet OR w.id = v_escrow_wallet
     OR w.id IN (
       SELECT wt.source_wallet_id FROM aviator.game_bets b
       JOIN wallet.wallet_transactions wt ON wt.idempotency_key = 'BET_LOCK_' || b.idempotency_key
       WHERE b.round_id = p_round_id AND b.status = 'PENDING'
     )
  ORDER BY w.id FOR UPDATE;
  GET DIAGNOSTICS v_locked_wallets = ROW_COUNT;
  SELECT 2 + count(DISTINCT wt.source_wallet_id) INTO v_expected_wallet_locks
  FROM aviator.game_bets b
  JOIN wallet.wallet_transactions wt ON wt.idempotency_key = 'BET_LOCK_' || b.idempotency_key
  WHERE b.round_id = p_round_id AND b.status = 'PENDING';
  IF v_locked_wallets <> v_expected_wallet_locks THEN RAISE EXCEPTION 'WALLET_LOCK_SET_INCOMPLETE'; END IF;
  IF (SELECT reserved_balance FROM wallet.wallets WHERE id = v_pool_wallet) < v_total_liability THEN
    RAISE EXCEPTION 'POOL_RESERVED_LIABILITY_MISMATCH';
  END IF;

  FOR v_bet IN
    SELECT b.*, wt.source_wallet_id AS player_wallet_id, wt.id AS lock_transaction_id
    FROM aviator.game_bets b
    JOIN wallet.wallet_transactions wt ON wt.idempotency_key = 'BET_LOCK_' || b.idempotency_key
    WHERE b.round_id = p_round_id AND b.status = 'PENDING'
    ORDER BY b.id FOR UPDATE OF b
  LOOP
    v_expected_liability := CEIL(v_bet.bet_amount::numeric * COALESCE(v_bet.auto_cashout, 50))::bigint;
    v_refund_tx := wallet.wallet_transfer_atomic(
      'BET_REFUND_' || replace(v_bet.id::text, '-', ''),
      'BET_ESCROW_REFUND'::public.transaction_type_enum,
      v_bet.bet_amount, v_escrow_wallet, v_bet.player_wallet_id,
      jsonb_build_object('betId', v_bet.id, 'roundId', p_round_id,
        'reason', 'stale_waiting_round_refund',
        'originalEscrowLockId', v_bet.lock_transaction_id)
    );
    UPDATE wallet.wallets
    SET reserved_balance = reserved_balance - v_expected_liability, updated_at = now()
    WHERE id = v_pool_wallet AND reserved_balance >= v_expected_liability;
    IF NOT FOUND THEN RAISE EXCEPTION 'POOL_RESERVATION_RELEASE_FAILED: %', v_bet.id; END IF;
    UPDATE aviator.game_bets SET status = 'CANCELLED', payout_amount = 0
    WHERE id = v_bet.id AND status = 'PENDING';
    IF NOT FOUND THEN RAISE EXCEPTION 'BET_STATE_CHANGED: %', v_bet.id; END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('roundId', p_round_id, 'refundedBets', v_count,
    'refundAmount', v_refund_total, 'releasedLiability', v_total_liability,
    'status', 'CANCELLED_AND_REFUNDED');
END
$function$;
REVOKE ALL ON FUNCTION aviator.refund_stale_waiting_round_pending_bets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.refund_stale_waiting_round_pending_bets(uuid) TO service_role;
