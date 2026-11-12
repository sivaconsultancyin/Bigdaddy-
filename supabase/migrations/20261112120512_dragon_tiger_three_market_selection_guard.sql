-- Enforce the only supported Dragon Tiger markets at the database boundary.
-- This trigger protects both the API RPC and direct database writes.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION dragon_tiger.validate_bet_selection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  IF jsonb_typeof(NEW.selection) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_DRAGON_TIGER_SELECTION' USING ERRCODE = '22023';
  END IF;

  v_type := lower(coalesce(NEW.selection->>'type', ''));
  IF v_type NOT IN ('dragon', 'tiger', 'tie') THEN
    RAISE EXCEPTION 'INVALID_DRAGON_TIGER_SELECTION' USING ERRCODE = '22023';
  END IF;

  IF NEW.bet_amount <= 0 OR NEW.bet_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_DRAGON_TIGER_AMOUNT' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_dragon_tiger_bet_selection
  ON dragon_tiger.authoritative_game_bets;

CREATE TRIGGER validate_dragon_tiger_bet_selection
BEFORE INSERT OR UPDATE OF selection, bet_amount
ON dragon_tiger.authoritative_game_bets
FOR EACH ROW
EXECUTE FUNCTION dragon_tiger.validate_bet_selection();

REVOKE ALL ON FUNCTION dragon_tiger.validate_bet_selection() FROM PUBLIC, anon, authenticated;

COMMIT;
