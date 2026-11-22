BEGIN;
ALTER FUNCTION aviator.cashout_crash_bet_atomic(uuid, uuid, text)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION aviator.settle_crash_round_atomic(uuid)
  SET search_path = pg_catalog, pg_temp;
COMMIT;