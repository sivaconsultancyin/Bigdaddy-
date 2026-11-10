-- Persist sanitized backend/API failures for the Owner Dashboard.
-- Event payloads must never contain credentials, tokens, request bodies, or SQL parameters.
BEGIN;

CREATE TABLE IF NOT EXISTS platform.system_health_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  component text NOT NULL,
  reason_code text NOT NULL,
  reason text NOT NULL,
  recovery text NOT NULL
);

CREATE INDEX IF NOT EXISTS system_health_events_occurred_at_idx
  ON platform.system_health_events (occurred_at DESC);

REVOKE ALL ON TABLE platform.system_health_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE platform.system_health_events TO service_role;

COMMIT;
