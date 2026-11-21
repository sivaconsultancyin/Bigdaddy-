-- Reduce launcher traffic while a valid lease is held, and retry recovery
-- promptly after an abandoned continuation lease expires.
DO $migration$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'bigdaddy-aviator-engine'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Required cron job bigdaddy-aviator-engine was not found';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    '15 seconds',
    $command$
      DO $watchdog$
      BEGIN
        -- Preserve the existing stale-round recovery on every watchdog run,
        -- even when a pending bet causes the launcher request to be suppressed.
        PERFORM aviator.recover_stale_waiting_rounds(120);

        -- Do not make an HTTP launcher request while any worker or handoff
        -- still owns a non-expired lease. NOT EXISTS also handles a missing
        -- lease row by allowing the launcher to attempt an acquisition.
        IF NOT EXISTS (
          SELECT 1
          FROM aviator.engine_worker_lease
          WHERE lease_key = 'aviator'
            AND lease_expires_at > clock_timestamp()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM aviator.game_rounds r
          JOIN aviator.game_bets b ON b.round_id = r.id
          WHERE r.game_code = 'aviator'
            AND r.status = 'WAITING'
            AND b.status = 'PENDING'
            AND r.started_at < now() - interval '2 minutes'
        ) THEN
          PERFORM net.http_post(
            url := 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/aviator-engine',
            body := '{}'::jsonb,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-aviator-engine-secret',
              (SELECT decrypted_secret
               FROM vault.decrypted_secrets
               WHERE name = 'aviator_engine_secret'
               LIMIT 1)
            ),
            timeout_milliseconds := 15000
          );
        END IF;
      END
    $command$
  );
END
$migration$;
