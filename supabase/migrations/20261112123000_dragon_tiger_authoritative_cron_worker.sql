-- Keep Dragon Tiger rounds moving even when no player is polling the game state.
-- The authoritative function serializes concurrent calls with a transaction advisory lock.
-- Do not advance rounds until the game has explicitly been activated in platform.games.
DO $migration$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'bigdaddy-dragon-tiger-engine'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'bigdaddy-dragon-tiger-engine',
    '1 second',
    $job$
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM platform.games
          WHERE code = 'dragon_tiger'
            AND status = 'ACTIVE'
        )
        THEN dragon_tiger.advance_round()
        ELSE NULL::jsonb
      END;
    $job$
  );
END;
$migration$;
