-- Broadcast only authoritative Dragon Tiger lifecycle transitions.
-- The client treats these as wake-up events and reloads the authenticated state API.
CREATE OR REPLACE FUNCTION dragon_tiger.broadcast_round_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payload jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'id', NEW.id,
    'roundNumber', NEW.round_number,
    'status', CASE
      WHEN NEW.status = 'RUNNING' THEN 'REVEALING'
      WHEN NEW.status = 'SETTLED' THEN 'RESULT'
      ELSE NEW.status
    END,
    'openedAt', NEW.opened_at,
    'bettingEndsAt', NEW.betting_closes_at,
    'dragonCard', CASE WHEN NEW.status IN ('RUNNING','SETTLED') THEN NEW.result->'dragonCard' ELSE NULL END,
    'tigerCard', CASE WHEN NEW.status IN ('RUNNING','SETTLED') THEN NEW.result->'tigerCard' ELSE NULL END,
    'winner', CASE WHEN NEW.status = 'SETTLED' THEN NEW.result->>'winner' ELSE NULL END
  );

  PERFORM realtime.send(v_payload, 'dragon_tiger_round_changed', 'dragon_tiger:rounds', false);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION dragon_tiger.broadcast_round_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dragon_tiger.broadcast_round_change() TO service_role;

DROP TRIGGER IF EXISTS dragon_tiger_round_broadcast ON dragon_tiger.authoritative_game_rounds;
CREATE TRIGGER dragon_tiger_round_broadcast
AFTER INSERT OR UPDATE OF status ON dragon_tiger.authoritative_game_rounds
FOR EACH ROW
EXECUTE FUNCTION dragon_tiger.broadcast_round_change();
