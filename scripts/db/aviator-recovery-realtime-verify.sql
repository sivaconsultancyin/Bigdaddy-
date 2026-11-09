-- Assertions for the isolated Aviator recovery/Realtime migration fixture.
CREATE TRIGGER aviator_public_round_state_test
AFTER UPDATE ON aviator.game_rounds
FOR EACH ROW EXECUTE FUNCTION aviator.broadcast_public_round_state();

DO $verify$
DECLARE
  recovery_result jsonb;
  second_result jsonb;
  live_payload jsonb;
  tick_payload jsonb;
  terminal_payload jsonb;
BEGIN
  recovery_result := aviator.recover_stale_waiting_rounds(120);
  IF (recovery_result->>'recoveredRounds')::integer <> 1
     OR (recovery_result->>'blockedRounds')::integer <> 1 THEN
    RAISE EXCEPTION 'Expected one safely recovered and one blocked stale round, got %', recovery_result;
  END IF;

  IF (SELECT status FROM aviator.game_bets WHERE id='00000000-0000-4000-8000-000000000201') <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Validated stale round bet was not cancelled';
  END IF;
  IF (SELECT status FROM aviator.game_bets WHERE id='00000000-0000-4000-8000-000000000202') <> 'PENDING' THEN
    RAISE EXCEPTION 'Mismatched-liability bet must remain pending for reconciliation';
  END IF;
  IF (SELECT balance FROM wallet.wallets WHERE id='00000000-0000-4000-8000-000000000003') <> 900
     OR (SELECT balance FROM wallet.wallets WHERE id='00000000-0000-4000-8000-000000000002') <> 100
     OR (SELECT reserved_balance FROM wallet.wallets WHERE id='00000000-0000-4000-8000-000000000001') <> 100 THEN
    RAISE EXCEPTION 'Validated refund did not update player, escrow, and pool liability exactly once';
  END IF;
  IF (SELECT count(*) FROM wallet.wallet_transactions WHERE idempotency_key='BET_REFUND_00000000000040008000000000000201') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one escrow refund transaction';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.system_health_events
    WHERE reason_code='STALE_WAITING_ROUND_REFUNDED'
  ) OR NOT EXISTS (
    SELECT 1 FROM platform.system_health_events
    WHERE reason_code='STALE_WAITING_REFUND_BLOCKED' AND status_code=409
  ) THEN
    RAISE EXCEPTION 'Recovery audit events are missing';
  END IF;

  second_result := aviator.recover_stale_waiting_rounds(120);
  IF (second_result->>'recoveredRounds')::integer <> 0
     OR (SELECT count(*) FROM wallet.wallet_transactions WHERE type='BET_ESCROW_REFUND') <> 1 THEN
    RAISE EXCEPTION 'Recovery retry duplicated a refund';
  END IF;

  UPDATE aviator.game_rounds
  SET started_at = now()
  WHERE id='00000000-0000-4000-8000-000000000101';

  SELECT payload INTO live_payload
  FROM realtime.broadcast_events
  WHERE event_name='round_state_changed'
    AND payload->>'id'='00000000-0000-4000-8000-000000000101'
    AND payload->>'status'='RUNNING'
  ORDER BY ctid DESC LIMIT 1;
  IF live_payload IS NULL OR live_payload ? 'crashMultiplier' THEN
    RAISE EXCEPTION 'Public RUNNING lifecycle event exposed the crash target: %', live_payload;
  END IF;

  PERFORM aviator.tick_crash_engine_with_broadcast();
  SELECT payload INTO tick_payload
  FROM realtime.broadcast_events
  WHERE event_name='round_state_changed'
    AND payload->>'id'='00000000-0000-4000-8000-000000000101'
    AND payload->>'multiplier'='1.23'
  ORDER BY ctid DESC LIMIT 1;
  IF tick_payload IS NULL OR tick_payload ? 'crashMultiplier' THEN
    RAISE EXCEPTION 'RUNNING multiplier tick was not safely broadcast: %', tick_payload;
  END IF;

  UPDATE aviator.game_rounds
  SET status='CRASHED', ended_at=now()
  WHERE id='00000000-0000-4000-8000-000000000101';
  SELECT payload INTO terminal_payload
  FROM realtime.broadcast_events
  WHERE event_name='round_state_changed'
    AND payload->>'id'='00000000-0000-4000-8000-000000000101'
    AND payload->>'status'='CRASHED'
  ORDER BY ctid DESC LIMIT 1;
  IF terminal_payload IS NULL OR terminal_payload->>'crashMultiplier' <> '2.5' THEN
    RAISE EXCEPTION 'Terminal lifecycle event did not reveal the final crash multiplier';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='bigdaddy-aviator-engine') THEN
    RAISE EXCEPTION 'Fail-closed Aviator scheduler was not installed in the isolated fixture';
  END IF;
  IF has_function_privilege('anon', 'aviator.recover_stale_waiting_rounds(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'aviator.recover_stale_waiting_rounds(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'aviator.recover_stale_waiting_rounds(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Recovery function grants are not restricted to service_role';
  END IF;
END
$verify$;
