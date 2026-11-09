-- Shared wallet operations for the isolated Aviator backend.
-- Additive only: no existing wallet rows or production Aviator records are changed.
CREATE OR REPLACE FUNCTION wallet.aviator_wallet_operation(
  p_action text,
  p_user_id uuid,
  p_bet_id uuid,
  p_round_id uuid,
  p_amount bigint,
  p_liability bigint,
  p_multiplier numeric,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, wallet, platform
AS $function$
DECLARE
  v_player_wallet uuid;
  v_escrow_wallet uuid;
  v_pool_wallet uuid;
  v_pool_balance bigint;
  v_pool_reserved bigint;
  v_min_bet bigint;
  v_max_bet bigint;
  v_game_status text;
  v_source uuid;
  v_target uuid;
  v_type public.transaction_type_enum;
  v_key text;
  v_metadata jsonb;
  v_tx_id uuid;
  v_payout bigint;
  v_expected_amount bigint;
  v_existing wallet.wallet_transactions%ROWTYPE;
  v_role_count integer;
  v_role text;
  v_active boolean;
BEGIN
  IF p_action NOT IN ('DEBIT_BET', 'CASHOUT', 'CRASH_LOSS', 'REFUND_BET') THEN
    RAISE EXCEPTION 'INVALID_AVIATOR_WALLET_ACTION' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_bet_id IS NULL OR p_round_id IS NULL THEN
    RAISE EXCEPTION 'AVIATOR_OPERATION_IDS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE' USING ERRCODE = '22023';
  END IF;
  IF p_liability IS NULL OR p_liability < p_amount OR
     p_liability > p_amount * 50 THEN
    RAISE EXCEPTION 'INVALID_AVIATOR_LIABILITY' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR
     length(trim(p_idempotency_key)) < 8 OR
     length(p_idempotency_key) > 80 OR
     p_idempotency_key !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'INVALID_AVIATOR_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'CASHOUT' AND
     (p_multiplier IS NULL OR p_multiplier < 1 OR p_multiplier > 50) THEN
    RAISE EXCEPTION 'INVALID_CASHOUT_MULTIPLIER' USING ERRCODE = '22023';
  END IF;

  -- New bets and player cashouts require an active PLAYER. Crash settlement and
  -- refunds must still complete if an account was disabled after the bet.
  IF p_action IN ('DEBIT_BET', 'CASHOUT') THEN
    SELECT u.is_active, count(ra.role)::integer, min(ra.role::text)
      INTO v_active, v_role_count, v_role
      FROM platform.users u
      LEFT JOIN platform.role_assignments ra ON ra.user_id = u.id
     WHERE u.id = p_user_id
     GROUP BY u.id, u.is_active;
    IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'USER_NOT_FOUND_OR_DISABLED';
    END IF;
    IF v_role_count <> 1 OR v_role IS NULL THEN
      RAISE EXCEPTION 'AUTH_SERVICE_UNAVAILABLE';
    END IF;
    IF v_role <> 'PLAYER' THEN
      RAISE EXCEPTION 'PLAYER_ONLY';
    END IF;
  END IF;

  SELECT pool_wallet_id, min_bet, max_bet, status::text
    INTO v_pool_wallet, v_min_bet, v_max_bet, v_game_status
    FROM platform.games
   WHERE code = 'aviator';
  IF v_pool_wallet IS NULL THEN
    RAISE EXCEPTION 'AVIATOR_POOL_NOT_CONFIGURED';
  END IF;
  SELECT id INTO v_player_wallet
    FROM wallet.wallets
   WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
  SELECT id INTO v_escrow_wallet
    FROM wallet.wallets
   WHERE wallet_type = 'ESCROW'
   ORDER BY id
   LIMIT 1;
  IF v_player_wallet IS NULL OR v_escrow_wallet IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF p_action = 'DEBIT_BET' THEN
    IF v_game_status <> 'ACTIVE' THEN RAISE EXCEPTION 'CRASH_GAME_NOT_ACTIVE'; END IF;
    IF p_amount < v_min_bet OR p_amount > v_max_bet THEN
      RAISE EXCEPTION 'BET_OUT_OF_RANGE';
    END IF;
    v_source := v_player_wallet;
    v_target := v_escrow_wallet;
    v_type := 'BET_ESCROW_LOCK';
    v_key := 'AVIATOR2_BET_LOCK_' || p_idempotency_key;
    v_metadata := jsonb_build_object(
      'gameCode', 'aviator', 'betId', p_bet_id, 'roundId', p_round_id,
      'userId', p_user_id, 'liability', p_liability
    );
  ELSIF p_action = 'CASHOUT' THEN
    v_payout := floor(p_amount::numeric * p_multiplier)::bigint;
    IF v_payout <= 0 OR v_payout > p_liability THEN
      RAISE EXCEPTION 'PAYOUT_EXCEEDS_RESERVED_LIABILITY';
    END IF;
    v_source := v_pool_wallet;
    v_target := v_player_wallet;
    v_type := 'BET_WIN_PAYOUT';
    v_key := 'AVIATOR2_BET_PAYOUT_' || p_idempotency_key;
    v_metadata := jsonb_build_object(
      'gameCode', 'aviator', 'betId', p_bet_id, 'roundId', p_round_id,
      'multiplier', p_multiplier
    );
  ELSIF p_action = 'CRASH_LOSS' THEN
    v_source := v_escrow_wallet;
    v_target := v_pool_wallet;
    v_type := 'BET_LOSS_GAME_POOL';
    v_key := 'AVIATOR2_BET_LOSS_' || p_idempotency_key;
    v_metadata := jsonb_build_object(
      'gameCode', 'aviator', 'betId', p_bet_id, 'roundId', p_round_id,
      'settlement', 'crash_loss_to_game_pool'
    );
  ELSE
    v_source := v_escrow_wallet;
    v_target := v_player_wallet;
    v_type := 'BET_ESCROW_REFUND';
    v_key := 'AVIATOR2_BET_REFUND_' || p_idempotency_key;
    v_metadata := jsonb_build_object(
      'gameCode', 'aviator', 'betId', p_bet_id, 'roundId', p_round_id,
      'reason', 'aviator_bet_refund'
    );
  END IF;

  v_expected_amount := CASE WHEN p_action = 'CASHOUT' THEN v_payout ELSE p_amount END;

  -- Use the same global wallet-ID lock order as wallet_transfer_atomic.
  PERFORM w.id
    FROM wallet.wallets w
   WHERE w.id IN (v_pool_wallet, v_player_wallet, v_escrow_wallet)
   ORDER BY w.id
   FOR UPDATE;

  SELECT * INTO v_existing
    FROM wallet.wallet_transactions
   WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.source_wallet_id IS DISTINCT FROM v_source
       OR v_existing.target_wallet_id IS DISTINCT FROM v_target
       OR v_existing.amount IS DISTINCT FROM v_expected_amount
       OR v_existing.type IS DISTINCT FROM v_type
       OR COALESCE(v_existing.metadata, '{}'::jsonb) IS DISTINCT FROM v_metadata THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'action', p_action, 'transactionId', v_existing.id,
      'amount', v_existing.amount, 'replayed', true
    );
  END IF;

  SELECT balance, reserved_balance
    INTO v_pool_balance, v_pool_reserved
    FROM wallet.wallets
   WHERE id = v_pool_wallet
   FOR UPDATE;

  IF p_action = 'DEBIT_BET' THEN
    IF v_pool_balance - COALESCE(v_pool_reserved, 0) < p_liability THEN
      RAISE EXCEPTION 'GAME_POOL_INSUFFICIENT';
    END IF;
    v_tx_id := wallet.wallet_transfer_atomic(
      v_key, v_type, p_amount, v_source, v_target, v_metadata
    );
    UPDATE wallet.wallets
       SET reserved_balance = COALESCE(reserved_balance, 0) + p_liability,
           updated_at = now()
     WHERE id = v_pool_wallet;
  ELSIF p_action = 'CASHOUT' THEN
    IF COALESCE(v_pool_reserved, 0) < p_liability THEN
      RAISE EXCEPTION 'GAME_POOL_RESERVATION_INVARIANT_FAILED';
    END IF;
    v_tx_id := wallet.wallet_transfer_atomic(
      v_key, v_type, v_payout, v_source, v_target, v_metadata
    );
    PERFORM wallet.wallet_transfer_atomic(
      'AVIATOR2_BET_STAKE_' || p_idempotency_key,
      'BET_LOSS_GAME_POOL', p_amount, v_escrow_wallet, v_pool_wallet,
      jsonb_build_object('gameCode', 'aviator', 'betId', p_bet_id,
        'roundId', p_round_id, 'settlement', 'cashout_stake_recycled_to_game_pool')
    );
    UPDATE wallet.wallets
       SET reserved_balance = reserved_balance - p_liability, updated_at = now()
     WHERE id = v_pool_wallet AND reserved_balance >= p_liability;
    IF NOT FOUND THEN RAISE EXCEPTION 'GAME_POOL_RESERVATION_INVARIANT_FAILED'; END IF;
  ELSE
    IF COALESCE(v_pool_reserved, 0) < p_liability THEN
      RAISE EXCEPTION 'GAME_POOL_RESERVATION_INVARIANT_FAILED';
    END IF;
    v_tx_id := wallet.wallet_transfer_atomic(
      v_key, v_type, p_amount, v_source, v_target, v_metadata
    );
    UPDATE wallet.wallets
       SET reserved_balance = reserved_balance - p_liability, updated_at = now()
     WHERE id = v_pool_wallet AND reserved_balance >= p_liability;
    IF NOT FOUND THEN RAISE EXCEPTION 'GAME_POOL_RESERVATION_INVARIANT_FAILED'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'action', p_action, 'transactionId', v_tx_id,
    'amount', v_expected_amount,
    'replayed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION wallet.aviator_wallet_operation(text, uuid, uuid, uuid, bigint, bigint, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wallet.aviator_wallet_operation(text, uuid, uuid, uuid, bigint, bigint, numeric, text)
  TO service_role;
