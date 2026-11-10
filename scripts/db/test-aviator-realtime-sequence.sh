#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=postgres}"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$roles$;

CREATE SCHEMA aviator;
CREATE SCHEMA realtime;

CREATE TABLE aviator.game_rounds (
  id uuid PRIMARY KEY,
  round_number bigint NOT NULL,
  status text NOT NULL,
  started_at timestamptz,
  crash_multiplier numeric,
  ended_at timestamptz,
  server_seed_hash text,
  revealed_server_seed text
);

CREATE TABLE aviator.tick_test_control (
  action text NOT NULL,
  round_id uuid NOT NULL,
  multiplier numeric NOT NULL
);

INSERT INTO aviator.game_rounds (
  id, round_number, status, started_at, crash_multiplier,
  ended_at, server_seed_hash, revealed_server_seed
) VALUES (
  '00000000-0000-0000-0000-000000000111',
  42, 'RUNNING', now(), NULL, NULL, 'synthetic-hash', NULL
);

INSERT INTO aviator.tick_test_control(action, round_id, multiplier)
VALUES ('round_running', '00000000-0000-0000-0000-000000000111', 1.25);

CREATE FUNCTION aviator.tick_crash_engine()
RETURNS jsonb
LANGUAGE sql
AS $function$
  SELECT jsonb_build_object(
    'action', action,
    'roundId', round_id::text,
    'multiplier', multiplier::text
  )
  FROM aviator.tick_test_control
  LIMIT 1;
$function$;

CREATE TABLE realtime.test_events (
  payload jsonb NOT NULL,
  event_name text NOT NULL,
  topic text NOT NULL,
  private boolean NOT NULL
);

CREATE FUNCTION realtime.send(
  p_payload jsonb,
  p_event_name text,
  p_topic text,
  p_private boolean
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO realtime.test_events(payload, event_name, topic, private)
  VALUES (p_payload, p_event_name, p_topic, p_private);
  RETURN true;
END;
$function$;
SQL

psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261110120000_aviator_realtime_event_sequence.sql

psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT aviator.tick_crash_engine_with_broadcast();
SELECT aviator.tick_crash_engine_with_broadcast();

DO $verify$
DECLARE
  v_seq bigint;
  v_events integer;
  v_first bigint;
  v_second bigint;
BEGIN
  SELECT multiplier_tick_seq INTO v_seq
  FROM aviator.game_rounds
  WHERE id = '00000000-0000-0000-0000-000000000111';

  SELECT count(*) INTO v_events FROM realtime.test_events;
  SELECT (payload->>'tickSequence')::bigint INTO v_first
  FROM realtime.test_events ORDER BY (payload->>'tickSequence')::bigint LIMIT 1;
  SELECT (payload->>'tickSequence')::bigint INTO v_second
  FROM realtime.test_events ORDER BY (payload->>'tickSequence')::bigint DESC LIMIT 1;

  IF v_seq <> 2 OR v_events <> 2 OR v_first <> 1 OR v_second <> 2 THEN
    RAISE EXCEPTION 'Expected sequence 1,2 and two events; got seq %, events %, first %, second %',
      v_seq, v_events, v_first, v_second;
  END IF;

  IF EXISTS (
    SELECT 1 FROM realtime.test_events
    WHERE event_name <> 'round_state_changed'
       OR topic <> 'aviator:rounds'
       OR private IS DISTINCT FROM false
       OR payload->>'multiplier' <> '1.25'
       OR payload->>'roundNumber' <> '42'
  ) THEN
    RAISE EXCEPTION 'Broadcast payload did not preserve the expected public round fields';
  END IF;
END
$verify$;

UPDATE aviator.tick_test_control SET action = 'round_waiting';
SELECT aviator.tick_crash_engine_with_broadcast();

DO $verify$
BEGIN
  IF (SELECT multiplier_tick_seq FROM aviator.game_rounds
      WHERE id = '00000000-0000-0000-0000-000000000111') <> 2
     OR (SELECT count(*) FROM realtime.test_events) <> 2 THEN
    RAISE EXCEPTION 'Non-running tick unexpectedly incremented sequence or broadcast';
  END IF;
END
$verify$;
SQL
