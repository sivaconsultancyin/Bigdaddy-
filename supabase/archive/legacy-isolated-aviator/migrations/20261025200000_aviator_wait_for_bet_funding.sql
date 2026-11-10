-- Do not start an Aviator round while any bet's cross-database wallet
-- debit is pending or being reconciled. This closes the round-start/debit race.
CREATE OR REPLACE FUNCTION aviator.start_round(p_round_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aviator
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
    FROM aviator.game_rounds
   WHERE id = p_round_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_status = 'RUNNING' THEN RETURN true; END IF;
  IF v_status <> 'WAITING' THEN RAISE EXCEPTION 'ROUND_NOT_WAITING'; END IF;

  -- Bet creation also locks the round row. Any pending funding status means
  -- the source wallet result has not yet been durably confirmed on this project.
  IF EXISTS (
    SELECT 1
      FROM aviator.game_bets b
     WHERE b.round_id = p_round_id
       AND b.funding_status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'ROUND_HAS_UNRESOLVED_BET_FUNDING';
  END IF;

  UPDATE aviator.game_rounds
     SET status = 'RUNNING', started_at = now()
   WHERE id = p_round_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION aviator.start_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.start_round(uuid) TO service_role;
