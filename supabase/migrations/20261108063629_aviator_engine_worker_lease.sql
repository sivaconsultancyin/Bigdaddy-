CREATE TABLE IF NOT EXISTS aviator.engine_worker_lease (
  lease_key text PRIMARY KEY CHECK (lease_key = 'aviator'),
  owner_token uuid,
  lease_expires_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  heartbeat_at timestamptz,
  generation bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE aviator.engine_worker_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE aviator.engine_worker_lease FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO aviator.engine_worker_lease (lease_key) VALUES ('aviator')
ON CONFLICT (lease_key) DO NOTHING;

CREATE OR REPLACE FUNCTION aviator.claim_crash_engine_lease(p_owner_token uuid, p_ttl_seconds integer DEFAULT 45)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_owner_token IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 120 THEN RETURN false; END IF;
  UPDATE aviator.engine_worker_lease
  SET owner_token = p_owner_token, lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds),
      heartbeat_at = clock_timestamp(), generation = generation + 1, updated_at = clock_timestamp()
  WHERE lease_key = 'aviator' AND lease_expires_at <= clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION aviator.consume_crash_engine_handoff(p_handoff_token uuid, p_new_owner_token uuid, p_ttl_seconds integer DEFAULT 45)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_handoff_token IS NULL OR p_new_owner_token IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 120 THEN RETURN false; END IF;
  UPDATE aviator.engine_worker_lease
  SET owner_token = p_new_owner_token, lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds),
      heartbeat_at = clock_timestamp(), generation = generation + 1, updated_at = clock_timestamp()
  WHERE lease_key = 'aviator' AND owner_token = p_handoff_token AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION aviator.heartbeat_crash_engine_lease(p_owner_token uuid, p_ttl_seconds integer DEFAULT 45)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_owner_token IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 120 THEN RETURN false; END IF;
  UPDATE aviator.engine_worker_lease
  SET lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds),
      heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE lease_key = 'aviator' AND owner_token = p_owner_token AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION aviator.handoff_crash_engine_lease(p_owner_token uuid, p_handoff_token uuid, p_ttl_seconds integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_owner_token IS NULL OR p_handoff_token IS NULL OR p_owner_token = p_handoff_token OR p_ttl_seconds < 10 OR p_ttl_seconds > 120 THEN RETURN false; END IF;
  UPDATE aviator.engine_worker_lease
  SET owner_token = p_handoff_token, lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds),
      heartbeat_at = clock_timestamp(), generation = generation + 1, updated_at = clock_timestamp()
  WHERE lease_key = 'aviator' AND owner_token = p_owner_token AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION aviator.release_crash_engine_lease(p_owner_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE aviator.engine_worker_lease
  SET owner_token = NULL, lease_expires_at = clock_timestamp(), heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE lease_key = 'aviator' AND owner_token = p_owner_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION aviator.claim_crash_engine_lease(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.consume_crash_engine_handoff(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.heartbeat_crash_engine_lease(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.handoff_crash_engine_lease(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aviator.release_crash_engine_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.claim_crash_engine_lease(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.consume_crash_engine_handoff(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.heartbeat_crash_engine_lease(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.handoff_crash_engine_lease(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aviator.release_crash_engine_lease(uuid) TO service_role;
