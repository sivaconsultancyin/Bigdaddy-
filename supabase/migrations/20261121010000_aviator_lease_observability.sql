-- The Edge Function uses the service role key to read its own lease metadata
-- after the SECURITY DEFINER acquisition RPC succeeds. RLS remains enabled;
-- service_role is a backend-only credential and bypasses RLS by design.
GRANT SELECT ON TABLE aviator.engine_worker_lease TO service_role;
