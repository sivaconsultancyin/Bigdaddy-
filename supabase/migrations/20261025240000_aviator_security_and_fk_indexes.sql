-- Isolated Aviator database hardening.
-- This migration is intentionally part of the isolated-backend PR branch only.
-- It must not be applied to the shared BigDaddy project.

-- Event-trigger functions are invoked by PostgreSQL's event-trigger mechanism;
-- browser roles must not be able to call this SECURITY DEFINER function via PostgREST.
-- Keep the explicit service_role grant for administrative compatibility.
-- PostgreSQL checks function EXECUTE privilege when the event trigger is created;
-- firing the already-registered event trigger does not require browser-role EXECUTE.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- Cover the two round_id foreign keys identified by Supabase's advisor.
CREATE INDEX IF NOT EXISTS game_bets_round_id_idx
  ON aviator.game_bets (round_id);

CREATE INDEX IF NOT EXISTS game_settlements_round_id_idx
  ON aviator.game_settlements (round_id);
