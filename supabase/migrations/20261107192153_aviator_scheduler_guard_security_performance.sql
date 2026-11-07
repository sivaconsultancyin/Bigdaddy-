-- BigDaddy Aviator recovery guard plus safe RLS and FK-index hardening.
-- The scheduler is registered but will not invoke the engine while an old WAITING
-- round still contains pending bets. This prevents an outage-recovery tick from
-- starting a stale round and risking an unattended player's reserved stake.

-- Explicit deny policies for backend-only tables. service_role and postgres bypass
-- RLS; anon/authenticated already have no table privileges, and remain denied.
DO $policies$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('andar_bahar','authoritative_game_bets'),
      ('andar_bahar','authoritative_game_rounds'),
      ('dice','authoritative_game_bets'),
      ('dice','authoritative_game_rounds'),
      ('dragon_tiger','authoritative_game_bets'),
      ('dragon_tiger','authoritative_game_rounds'),
      ('roulette','authoritative_game_bets'),
      ('roulette','authoritative_game_rounds'),
      ('platform','system_health_events')
    ) AS t(schema_name, table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = item.schema_name
        AND tablename = item.table_name
        AND policyname = 'deny_anon_authenticated_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY deny_anon_authenticated_all ON %I.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        item.schema_name, item.table_name
      );
    END IF;
  END LOOP;
END
$policies$;

-- Add only the 13 FK indexes confirmed missing by pg_index coverage checks.
-- Keep all existing indexes; unused-index advice is not enough evidence to drop them.
CREATE INDEX IF NOT EXISTS idx_andar_bahar_bets_escrow_tx
  ON andar_bahar.authoritative_game_bets (escrow_transaction_id);
CREATE INDEX IF NOT EXISTS idx_andar_bahar_bets_payout_tx
  ON andar_bahar.authoritative_game_bets (payout_transaction_id);
CREATE INDEX IF NOT EXISTS idx_andar_bahar_bets_stake_release_tx
  ON andar_bahar.authoritative_game_bets (stake_release_transaction_id);

CREATE INDEX IF NOT EXISTS idx_dice_bets_escrow_tx
  ON dice.authoritative_game_bets (escrow_transaction_id);
CREATE INDEX IF NOT EXISTS idx_dice_bets_payout_tx
  ON dice.authoritative_game_bets (payout_transaction_id);
CREATE INDEX IF NOT EXISTS idx_dice_bets_stake_release_tx
  ON dice.authoritative_game_bets (stake_release_transaction_id);

CREATE INDEX IF NOT EXISTS idx_dragon_tiger_bets_escrow_tx
  ON dragon_tiger.authoritative_game_bets (escrow_transaction_id);
CREATE INDEX IF NOT EXISTS idx_dragon_tiger_bets_payout_tx
  ON dragon_tiger.authoritative_game_bets (payout_transaction_id);
CREATE INDEX IF NOT EXISTS idx_dragon_tiger_bets_stake_release_tx
  ON dragon_tiger.authoritative_game_bets (stake_release_transaction_id);

CREATE INDEX IF NOT EXISTS idx_roulette_bets_escrow_tx
  ON roulette.authoritative_game_bets (escrow_transaction_id);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_payout_tx
  ON roulette.authoritative_game_bets (payout_transaction_id);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_stake_release_tx
  ON roulette.authoritative_game_bets (stake_release_transaction_id);

CREATE INDEX IF NOT EXISTS idx_game_pools_wallet_id
  ON platform.game_pools (wallet_id);

-- Restore the one-minute launcher. aviator-engine self-continues in bounded
-- invocations. The guard holds the scheduler while a stale WAITING round has
-- pending bets; after an explicit, audited refund/reconciliation, it resumes.
DO $scheduler$
DECLARE
  existing_job bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'aviator_engine_secret'
      AND length(decrypted_secret) >= 32
  ) THEN
    RAISE EXCEPTION 'aviator_engine_secret is missing or invalid; scheduler not created';
  END IF;

  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'bigdaddy-aviator-engine'
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;

  PERFORM cron.schedule(
    'bigdaddy-aviator-engine',
    '* * * * *',
    $command$
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM aviator.game_rounds r
          JOIN aviator.game_bets b ON b.round_id = r.id
          WHERE r.game_code = 'aviator'
            AND r.status = 'WAITING'
            AND b.status = 'PENDING'
            AND r.started_at < now() - interval '2 minutes'
        )
        THEN net.http_post(
          url := 'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/aviator-engine',
          body := '{}'::jsonb,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-aviator-engine-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aviator_engine_secret' LIMIT 1)
          ),
          timeout_milliseconds := 60000
        )
        ELSE NULL::bigint
      END;
    $command$
  );
END
$scheduler$;
