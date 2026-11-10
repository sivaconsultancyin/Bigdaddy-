-- Establish a stable wallet-owned API boundary without moving legacy tables yet.
-- The underlying public function remains the compatibility implementation until
-- the wallet tables and financial functions are migrated in a later release.
BEGIN;

CREATE OR REPLACE FUNCTION wallet.wallet_transfer_atomic(
  p_idempotency_key text,
  p_type public.transaction_type_enum,
  p_amount bigint,
  p_source_wallet_id uuid,
  p_target_wallet_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT public.wallet_transfer_atomic(
    p_idempotency_key,
    p_type,
    p_amount,
    p_source_wallet_id,
    p_target_wallet_id,
    p_metadata
  );
$function$;

COMMENT ON FUNCTION wallet.wallet_transfer_atomic(
  text, public.transaction_type_enum, bigint, uuid, uuid, jsonb
) IS 'Server-side wallet API boundary. Delegates to the legacy implementation until the wallet schema cutover is complete.';

REVOKE ALL ON FUNCTION wallet.wallet_transfer_atomic(
  text, public.transaction_type_enum, bigint, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION wallet.wallet_transfer_atomic(
  text, public.transaction_type_enum, bigint, uuid, uuid, jsonb
) TO service_role;

COMMIT;
