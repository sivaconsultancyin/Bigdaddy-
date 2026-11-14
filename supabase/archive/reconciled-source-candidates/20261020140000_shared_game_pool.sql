-- Route every catalog game through one shared game-pool wallet.
-- Existing pool wallets are retained for historical foreign-key references.
-- No funds are minted or transferred by this migration.
ALTER TABLE public.game_pools DROP CONSTRAINT IF EXISTS game_pools_wallet_id_key;

DO $$
DECLARE
  shared_wallet uuid;
BEGIN
  SELECT id INTO shared_wallet
  FROM public.wallets
  WHERE wallet_type = 'GAME_POOL'::public.wallet_type_enum
    AND game_code = 'aviator'
  ORDER BY created_at
  LIMIT 1;

  IF shared_wallet IS NULL THEN
    RAISE EXCEPTION 'Shared Aviator game pool wallet not found';
  END IF;

  UPDATE public.game_pools SET wallet_id = shared_wallet;
  UPDATE public.games SET pool_wallet_id = shared_wallet;
END
$$;
