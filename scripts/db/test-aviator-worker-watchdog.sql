CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigint PRIMARY KEY,
  jobname text NOT NULL,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO cron.job(jobid, jobname, schedule, command)
VALUES (5, 'bigdaddy-aviator-engine', '* * * * *', 'SELECT 1');

CREATE FUNCTION cron.alter_job(
  job_id bigint,
  schedule text DEFAULT NULL,
  command text DEFAULT NULL,
  database text DEFAULT NULL,
  username text DEFAULT NULL,
  active boolean DEFAULT NULL
) RETURNS bigint LANGUAGE sql AS $$
  UPDATE cron.job
  SET schedule = COALESCE($2, schedule),
      command = COALESCE($3, command),
      active = COALESCE($6, active)
  WHERE jobid = $1
  RETURNING jobid
$$;

CREATE SCHEMA aviator;
CREATE TABLE aviator.engine_worker_lease (
  lease_key text PRIMARY KEY,
  lease_expires_at timestamptz NOT NULL
);
CREATE TABLE aviator.game_rounds (
  id bigint PRIMARY KEY,
  game_code text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL
);
CREATE TABLE aviator.game_bets (
  id bigint PRIMARY KEY,
  round_id bigint NOT NULL,
  status text NOT NULL
);
CREATE TABLE aviator.watchdog_audit (
  recovery_calls integer NOT NULL DEFAULT 0,
  http_calls integer NOT NULL DEFAULT 0
);
INSERT INTO aviator.watchdog_audit DEFAULT VALUES;
CREATE FUNCTION aviator.recover_stale_waiting_rounds(integer)
RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  UPDATE aviator.watchdog_audit SET recovery_calls = recovery_calls + 1;
  RETURN 0;
END
$$;

CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  UPDATE aviator.watchdog_audit SET http_calls = http_calls + 1;
  RETURN 1;
END
$$;

CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('aviator_engine_secret', 'ci-secret');

\i supabase/migrations/20261121000000_aviator_worker_reliability_watchdog.sql

DO $verify$
DECLARE
  v_command text;
  v_recovery integer;
  v_http integer;
BEGIN
  SELECT schedule, command INTO STRICT v_command, v_command FROM cron.job
  WHERE jobname = 'bigdaddy-aviator-engine';
  IF (SELECT schedule FROM cron.job WHERE jobname = 'bigdaddy-aviator-engine') <> '15 seconds' THEN
    RAISE EXCEPTION 'Watchdog schedule was not changed to 15 seconds';
  END IF;

  -- Healthy lease: recovery still runs, but no launcher HTTP request is sent.
  INSERT INTO aviator.engine_worker_lease VALUES ('aviator', clock_timestamp() + interval '30 seconds');
  EXECUTE v_command;
  SELECT recovery_calls, http_calls INTO v_recovery, v_http FROM aviator.watchdog_audit;
  IF v_recovery <> 1 OR v_http <> 0 THEN
    RAISE EXCEPTION 'Healthy lease should suppress HTTP while retaining recovery; got recovery %, HTTP %', v_recovery, v_http;
  END IF;

  -- Expired lease: launcher is called.
  UPDATE aviator.engine_worker_lease SET lease_expires_at = clock_timestamp() - interval '1 second';
  EXECUTE v_command;
  SELECT recovery_calls, http_calls INTO v_recovery, v_http FROM aviator.watchdog_audit;
  IF v_recovery <> 2 OR v_http <> 1 THEN
    RAISE EXCEPTION 'Expired lease should trigger one launcher request; got recovery %, HTTP %', v_recovery, v_http;
  END IF;

  -- Stale WAITING round with a pending bet: recovery runs first, launcher stays suppressed.
  INSERT INTO aviator.game_rounds VALUES (1, 'aviator', 'WAITING', clock_timestamp() - interval '3 minutes');
  INSERT INTO aviator.game_bets VALUES (1, 1, 'PENDING');
  EXECUTE v_command;
  SELECT recovery_calls, http_calls INTO v_recovery, v_http FROM aviator.watchdog_audit;
  IF v_recovery <> 3 OR v_http <> 1 THEN
    RAISE EXCEPTION 'Stale pending bet should not be bypassed; got recovery %, HTTP %', v_recovery, v_http;
  END IF;

  -- Missing lease row must not permanently block the launcher.
  DELETE FROM aviator.engine_worker_lease;
  DELETE FROM aviator.game_bets;
  DELETE FROM aviator.game_rounds;
  EXECUTE v_command;
  SELECT recovery_calls, http_calls INTO v_recovery, v_http FROM aviator.watchdog_audit;
  IF v_recovery <> 4 OR v_http <> 2 THEN
    RAISE EXCEPTION 'Missing lease row should permit launcher recovery; got recovery %, HTTP %', v_recovery, v_http;
  END IF;
END
$verify$;
