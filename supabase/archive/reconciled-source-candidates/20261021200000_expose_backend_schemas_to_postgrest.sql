-- Allow the Supabase Data API to resolve backend-owned schemas used by the Edge API.
-- Anonymous and authenticated roles retain no USAGE on these schemas; service_role is used by the Edge Function.
ALTER ROLE authenticator SET pgrst.db_schemas = 'public,graphql_public,platform,wallet,aviator,roulette,dice,dragon_tiger,andar_bahar';
NOTIFY pgrst, 'reload config';
