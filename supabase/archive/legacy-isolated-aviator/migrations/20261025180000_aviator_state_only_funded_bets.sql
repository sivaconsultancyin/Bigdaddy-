-- Never publish a bet into the game-state response until its shared-wallet
-- debit has succeeded. Pending outbox intents are not funded bets.
CREATE OR REPLACE FUNCTION aviator.get_aviator_state_bundle()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, aviator, extensions
AS $function$
  WITH recent_rounds AS (
    SELECT id, game_code, round_number, status, started_at, ended_at,
           crash_multiplier, server_seed_hash, revealed_server_seed
      FROM aviator.game_rounds
     WHERE game_code = 'aviator'
     ORDER BY round_number DESC
     LIMIT 25
  ),
  current_round AS (
    SELECT * FROM recent_rounds
     WHERE status IN ('WAITING','RUNNING')
     ORDER BY round_number DESC
     LIMIT 1
  ),
  current_bets AS (
    SELECT b.id, b.round_id, b.bet_amount, b.auto_cashout, b.cashed_out_at,
           b.payout_amount, b.status, b.created_at
      FROM aviator.game_bets b
      JOIN current_round r ON r.id = b.round_id
     WHERE b.funding_status = 'FUNDED'
     ORDER BY b.created_at
  )
  SELECT jsonb_build_object(
    'round', (SELECT to_jsonb(r) FROM current_round r),
    'rounds', COALESCE(
      (SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.round_number DESC) FROM recent_rounds rr),
      '[]'::jsonb
    ),
    'bets', COALESCE(
      (SELECT jsonb_agg(to_jsonb(cb) ORDER BY cb.created_at) FROM current_bets cb),
      '[]'::jsonb
    )
  );
$function$;

REVOKE ALL ON FUNCTION aviator.get_aviator_state_bundle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.get_aviator_state_bundle() TO service_role;
