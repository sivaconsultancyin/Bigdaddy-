-- Single-owner lease for the Aviator tick worker.
-- Cron and self-continuation can race, but only one owner may execute ticks.
CREATE TABLE IF NOT EXISTS aviator.engine_worker_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  worker_id text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO aviator.engine_worker_lease(singleton, worker_id, lease_until, heartbeat_at)
VALUES (true, NULL, NULL, NULL)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE aviator.engine_worker_lease ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon_authenticated_all ON aviator.engine_worker_lease;
CREATE POLICY deny_anon_authenticated_all ON aviator.engine_worker_lease
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON aviator.engine_worker_lease FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON aviator.engine_worker_lease TO service_role;

CREATE OR REPLACE FUNCTION aviator.acquire_engine_worker_lease(p_worker_id text, p_lease_seconds integer DEFAULT 15)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, aviator AS $$
DECLARE acquired boolean;
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) < 16 OR length(p_worker_id) > 100
     OR p_lease_seconds < 5 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'INVALID_ENGINE_LEASE_ARGUMENT';
  END IF;
  UPDATE aviator.engine_worker_lease
  SET worker_id = p_worker_id, lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE singleton = true AND (worker_id IS NULL OR lease_until IS NULL OR lease_until <= clock_timestamp()
      OR worker_id = p_worker_id);
  GET DIAGNOSTICS acquired = ROW_COUNT;
  RETURN acquired;
END $$;

CREATE OR REPLACE FUNCTION aviator.heartbeat_engine_worker_lease(p_worker_id text, p_lease_seconds integer DEFAULT 15)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, aviator AS $$
DECLARE renewed integer;
BEGIN
  UPDATE aviator.engine_worker_lease
  SET lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE singleton = true AND worker_id = p_worker_id AND lease_until > clock_timestamp();
  GET DIAGNOSTICS renewed = ROW_COUNT;
  RETURN renewed = 1;
END $$;

CREATE OR REPLACE FUNCTION aviator.release_engine_worker_lease(p_worker_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, aviator AS $$
DECLARE released integer;
BEGIN
  UPDATE aviator.engine_worker_lease
  SET worker_id = NULL, lease_until = NULL, heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE singleton = true AND worker_id = p_worker_id;
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released = 1;
END $$;

REVOKE ALL ON FUNCTION aviator.acquire_engine_worker_lease(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.heartbeat_engine_worker_lease(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.release_engine_worker_lease(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.acquire_engine_worker_lease(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.heartbeat_engine_worker_lease(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.release_engine_worker_lease(text) TO service_role;
