BEGIN;

-- The event trigger executes as its owning role; browser roles do not need
-- direct EXECUTE permission on this SECURITY DEFINER function.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS game_bets_round_id_idx
  ON aviator.game_bets (round_id);

CREATE INDEX IF NOT EXISTS game_settlements_round_id_idx
  ON aviator.game_settlements (round_id);

COMMIT;
