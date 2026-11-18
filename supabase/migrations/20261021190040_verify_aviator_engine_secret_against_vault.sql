CREATE OR REPLACE FUNCTION public.verify_aviator_engine_secret(p_supplied text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT decrypted_secret = p_supplied
     FROM vault.decrypted_secrets
     WHERE name = 'aviator_engine_secret'
     LIMIT 1),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.verify_aviator_engine_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_aviator_engine_secret(text) TO service_role;