-- Isolated PostgreSQL fixtures for 20261109090000_aviator_realtime_and_recovery_hardening.sql.
-- This database is ephemeral CI-only; never point this script at production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA platform;
CREATE SCHEMA wallet;
CREATE SCHEMA aviator;
CREATE SCHEMA realtime;
CREATE SCHEMA vault;
CREATE SCHEMA cron;
CREATE SCHEMA net;

CREATE TYPE public.transaction_type_enum AS ENUM ('BET_ESCROW_LOCK', 'BET_ESCROW_REFUND');

CREATE TABLE platform.games (
  code text PRIMARY KEY,
  status text NOT NULL,
  pool_wallet_id uuid NOT NULL
);
CREATE TABLE wallet.wallets (
  id uuid PRIMARY KEY,
  user_id uuid,
  wallet_type text NOT NULL,
  balance bigint NOT NULL DEFAULT 0,
  reserved_balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  type public.transaction_type_enum NOT NULL,
  amount bigint NOT NULL,
  source_wallet_id uuid,
  target_wallet_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE aviator.game_rounds (
  id uuid PRIMARY KEY,
  game_code text NOT NULL,
  round_number bigint NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  crash_multiplier numeric,
  server_seed_hash text,
  revealed_server_seed text
);
CREATE TABLE aviator.game_bets (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES aviator.game_rounds(id),
  user_id uuid NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  bet_amount bigint NOT NULL,
  auto_cashout numeric,
  payout_amount bigint NOT NULL DEFAULT 0
);
CREATE TABLE aviator.game_settlements (bet_id uuid PRIMARY KEY);
CREATE TABLE platform.system_health_events (
  id uuid PRIMARY KEY,
  request_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer NOT NULL,
  component text NOT NULL,
  reason_code text NOT NULL,
  reason text NOT NULL,
  recovery text NOT NULL
);
CREATE TABLE realtime.broadcast_events (
  payload jsonb NOT NULL,
  event_name text NOT NULL,
  topic text NOT NULL
);
CREATE TABLE vault.decrypted_secrets (
  name text PRIMARY KEY,
  decrypted_secret text NOT NULL
);
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text NOT NULL
);

CREATE FUNCTION realtime.send(jsonb, text, text, boolean)
RETURNS void LANGUAGE sql AS $function$
  INSERT INTO realtime.broadcast_events(payload, event_name, topic)
  VALUES ($1, $2, $3);
$function$;

CREATE FUNCTION aviator.tick_crash_engine()
RETURNS jsonb LANGUAGE sql AS $function$
  SELECT jsonb_build_object(
    'action', 'round_running',
    'roundId', '00000000-0000-4000-8000-000000000101',
    'multiplier', 1.23
  );
$function$;

CREATE FUNCTION wallet.wallet_transfer_atomic(
  p_idempotency_key text,
  p_type public.transaction_type_enum,
  p_amount bigint,
  p_source_wallet_id uuid,
  p_target_wallet_id uuid,
  p_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_TRANSFER_AMOUNT'; END IF;
  INSERT INTO wallet.wallet_transactions (
    idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata
  ) VALUES (
    p_idempotency_key, p_type, p_amount, p_source_wallet_id, p_target_wallet_id, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  UPDATE wallet.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = p_source_wallet_id AND balance >= p_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_SOURCE_BALANCE'; END IF;

  UPDATE wallet.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = p_target_wallet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_WALLET_NOT_FOUND'; END IF;
  RETURN v_id;
END;
$function$;

CREATE FUNCTION cron.unschedule(bigint)
RETURNS boolean LANGUAGE plpgsql AS $function$
BEGIN
  DELETE FROM cron.job WHERE jobid = $1;
  RETURN FOUND;
END;
$function$;

CREATE FUNCTION cron.schedule(text, text, text)
RETURNS bigint LANGUAGE plpgsql AS $function$
DECLARE v_jobid bigint;
BEGIN
  INSERT INTO cron.job(jobname) VALUES ($1) RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END;
$function$;

CREATE FUNCTION net.http_post(
  url text,
  body jsonb,
  headers jsonb,
  timeout_milliseconds integer
)
RETURNS bigint LANGUAGE sql AS $function$
  SELECT 1::bigint;
$function$;

INSERT INTO vault.decrypted_secrets(name, decrypted_secret)
VALUES ('aviator_engine_secret', repeat('x', 40));

INSERT INTO wallet.wallets(id, user_id, wallet_type, balance, reserved_balance) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'POOL', 0, 300),
  ('00000000-0000-4000-8000-000000000002', NULL, 'ESCROW', 200, 0),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000099', 'PLAYER', 800, 0);

INSERT INTO platform.games(code, status, pool_wallet_id)
VALUES ('aviator', 'ACTIVE', '00000000-0000-4000-8000-000000000001');

INSERT INTO aviator.game_rounds(
  id, game_code, round_number, status, started_at, crash_multiplier, server_seed_hash
) VALUES
  ('00000000-0000-4000-8000-000000000101', 'aviator', 101, 'RUNNING', now(), 2.5, 'hash-live'),
  ('00000000-0000-4000-8000-000000000102', 'aviator', 102, 'WAITING', now() - interval '5 minutes', NULL, 'hash-stale-good'),
  ('00000000-0000-4000-8000-000000000103', 'aviator', 103, 'WAITING', now() - interval '4 minutes', NULL, 'hash-stale-blocked');

INSERT INTO aviator.game_bets(id, round_id, user_id, status, idempotency_key, bet_amount, auto_cashout)
VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000099', 'PENDING', 'lock-good', 100, 2),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000099', 'PENDING', 'lock-blocked', 100, 2);

INSERT INTO wallet.wallet_transactions(idempotency_key, type, amount, source_wallet_id, target_wallet_id)
VALUES
  ('BET_LOCK_lock-good', 'BET_ESCROW_LOCK', 100, '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002'),
  ('BET_LOCK_lock-blocked', 'BET_ESCROW_LOCK', 100, '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002');
