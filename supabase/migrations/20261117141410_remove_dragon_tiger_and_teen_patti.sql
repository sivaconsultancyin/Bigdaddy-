-- Remove Dragon Tiger and Teen Patti game runtime from production.
-- Wallet balances and immutable wallet transaction history are intentionally preserved.
DO $$
DECLARE v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname ILIKE '%dragon%tiger%' OR jobname ILIKE '%teen%patti%'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END $$;

DROP SCHEMA IF EXISTS dragon_tiger CASCADE;
DROP SCHEMA IF EXISTS teen_patti CASCADE;

DELETE FROM platform.game_pools
WHERE game_code IN ('dragon_tiger','dragon-tiger','teen_patti','teen-patti');

DELETE FROM platform.games
WHERE code IN ('dragon_tiger','dragon-tiger','teen_patti','teen-patti');
