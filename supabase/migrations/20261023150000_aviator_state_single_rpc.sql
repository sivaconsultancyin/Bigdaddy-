-- Return the hot-polled Aviator state payload in one PostgREST round-trip.
-- Keep multiplier calculation in the Edge Function; Postgres returns persisted state only.
CREATE OR REPLACE FUNCTION aviator.get_aviator_state_bundle()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
  WITH recent_rounds AS (
    SELECT id, game_code, round_number, status, crash_multiplier, started_at, ended_at,
           server_seed_hash, revealed_server_seed
      FROM aviator.game_rounds
     WHERE game_code = 'aviator'
     ORDER BY round_number DESC
     LIMIT 25
  ),
  current_round AS (
    SELECT *
      FROM recent_rounds
     ORDER BY CASE WHEN status IN ('RUNNING', 'WAITING') THEN 0 ELSE 1 END,
              round_number DESC
     LIMIT 1
  ),
  current_bets AS (
    SELECT b.id, b.round_id, b.bet_amount, b.auto_cashout, b.status,
           b.payout_amount, b.cashed_out_at, b.created_at, u.username
      FROM aviator.game_bets AS b
      JOIN current_round AS r ON r.id = b.round_id
      LEFT JOIN platform.users AS u ON u.id = b.user_id
     ORDER BY b.created_at DESC
     LIMIT 100
  )
  SELECT jsonb_build_object(
    'rounds',
      COALESCE((SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.round_number DESC) FROM recent_rounds AS rr), '[]'::jsonb),
    'round',
      (SELECT to_jsonb(cr) FROM current_round AS cr),
    'bets',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cb.id,
          'round_id', cb.round_id,
          'bet_amount', cb.bet_amount,
          'auto_cashout', cb.auto_cashout,
          'status', cb.status,
          'payout_amount', cb.payout_amount,
          'cashed_out_at', cb.cashed_out_at,
          'username', COALESCE(cb.username, 'Player')
        ) ORDER BY cb.created_at DESC)
        FROM current_bets AS cb
      ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION aviator.get_aviator_state_bundle() FROM PUBLIC;
REVOKE ALL ON FUNCTION aviator.get_aviator_state_bundle() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.get_aviator_state_bundle() TO service_role, postgres;
