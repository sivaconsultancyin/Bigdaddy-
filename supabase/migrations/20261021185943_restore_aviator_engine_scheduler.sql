DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'bigdaddy-aviator-engine'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'bigdaddy-aviator-engine',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/aviator-engine',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aviator-engine-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aviator_engine_secret' LIMIT 1)
      ),
      timeout_milliseconds := 60000
    );
  $job$
);