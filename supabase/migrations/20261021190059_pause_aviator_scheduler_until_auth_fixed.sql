DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'bigdaddy-aviator-engine'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.verify_aviator_engine_secret(text);