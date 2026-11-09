-- Read-only contract checks for the isolated Aviator target project.
-- Safe to run against staging: this script does not insert, update, or delete data.
DO $test$
DECLARE
  v_count bigint;
  v_anon boolean;
  v_authenticated boolean;
  v_service boolean;
BEGIN
  -- Required isolated tables must exist.
  IF to_regclass('aviator.game_rounds') IS NULL
     OR to_regclass('aviator.game_bets') IS NULL
     OR to_regclass('aviator.game_settlements') IS NULL
     OR to_regclass('aviator.wallet_operations') IS NULL THEN
    RAISE EXCEPTION 'AVIATOR_SCHEMA_MISSING_REQUIRED_TABLE';
  END IF;

  -- No direct client access to privileged engine/worker RPCs.
  SELECT has_function_privilege('anon', 'aviator.tick_round_engine()', 'EXECUTE'),
         has_function_privilege('authenticated', 'aviator.tick_round_engine()', 'EXECUTE'),
         has_function_privilege('service_role', 'aviator.tick_round_engine()', 'EXECUTE')
    INTO v_anon, v_authenticated, v_service;
  IF v_anon OR v_authenticated OR NOT v_service THEN
    RAISE EXCEPTION 'AVIATOR_ENGINE_RPC_GRANTS_INVALID: anon=%, authenticated=%, service_role=%',
      v_anon, v_authenticated, v_service;
  END IF;

  SELECT has_function_privilege('anon', 'aviator.cashout_bet_intent(uuid,uuid)', 'EXECUTE'),
         has_function_privilege('authenticated', 'aviator.cashout_bet_intent(uuid,uuid)', 'EXECUTE'),
         has_function_privilege('service_role', 'aviator.cashout_bet_intent(uuid,uuid)', 'EXECUTE')
    INTO v_anon, v_authenticated, v_service;
  IF v_anon OR v_authenticated OR NOT v_service THEN
    RAISE EXCEPTION 'AVIATOR_CASHOUT_RPC_GRANTS_INVALID: anon=%, authenticated=%, service_role=%',
      v_anon, v_authenticated, v_service;
  END IF;

  -- Shared wallet operation must only be executable by the trusted server role.
  IF to_regprocedure('wallet.aviator_wallet_operation(text,uuid,uuid,uuid,bigint,bigint,numeric,text)') IS NOT NULL THEN
    SELECT has_function_privilege('anon', 'wallet.aviator_wallet_operation(text,uuid,uuid,uuid,bigint,bigint,numeric,text)', 'EXECUTE'),
           has_function_privilege('authenticated', 'wallet.aviator_wallet_operation(text,uuid,uuid,uuid,bigint,bigint,numeric,text)', 'EXECUTE'),
           has_function_privilege('service_role', 'wallet.aviator_wallet_operation(text,uuid,uuid,uuid,bigint,bigint,numeric,text)', 'EXECUTE')
      INTO v_anon, v_authenticated, v_service;
    IF v_anon OR v_authenticated OR NOT v_service THEN
      RAISE EXCEPTION 'AVIATOR_WALLET_RPC_GRANTS_INVALID';
    END IF;
  END IF;

  -- Enforce wallet-compatible maximum settlement multiplier.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='aviator' AND t.relname='game_settlements'
      AND c.conname='game_settlements_payout_multiplier_check'
      AND pg_get_constraintdef(c.oid) LIKE '%50%'
  ) THEN
    RAISE EXCEPTION 'AVIATOR_50X_PAYOUT_CAP_MISSING';
  END IF;

  -- This test is intended for a clean isolated staging target, not production.
  SELECT (SELECT count(*) FROM aviator.game_rounds)
       + (SELECT count(*) FROM aviator.game_bets)
       + (SELECT count(*) FROM aviator.game_settlements)
       + (SELECT count(*) FROM aviator.wallet_operations)
    INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AVIATOR_STAGING_NOT_EMPTY: total rows=%', v_count;
  END IF;

  RAISE NOTICE 'AVIATOR_ISOLATION_CONTRACT_OK: schema, privileged RPC grants, 50x cap, clean staging state';
END;
$test$;
