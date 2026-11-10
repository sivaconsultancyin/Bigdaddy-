-- The event trigger executes as its owner; browser roles do not need direct
-- EXECUTE permission on this SECURITY DEFINER helper. Keep the existing
-- service_role grant so the trigger can continue to run.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
