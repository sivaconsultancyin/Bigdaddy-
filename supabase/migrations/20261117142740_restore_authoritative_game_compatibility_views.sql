-- Recreate shared read-only compatibility views without retired games.
-- DROP SCHEMA ... CASCADE removed the prior UNION views that referenced Dragon Tiger.
-- Keep the remaining authoritative game schemas visible to service-role legacy readers.
CREATE VIEW public.authoritative_game_rounds AS
  SELECT * FROM roulette.authoritative_game_rounds
  UNION ALL
  SELECT * FROM dice.authoritative_game_rounds
  UNION ALL
  SELECT * FROM andar_bahar.authoritative_game_rounds;

CREATE VIEW public.authoritative_game_bets AS
  SELECT * FROM roulette.authoritative_game_bets
  UNION ALL
  SELECT * FROM dice.authoritative_game_bets
  UNION ALL
  SELECT * FROM andar_bahar.authoritative_game_bets;

REVOKE ALL ON public.authoritative_game_rounds, public.authoritative_game_bets
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.authoritative_game_rounds, public.authoritative_game_bets
  TO service_role;

NOTIFY pgrst, 'reload schema';
