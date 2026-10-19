-- Store a commitment before a round and reveal the secret after it crashes.
ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS server_seed_hash varchar,
  ADD COLUMN IF NOT EXISTS revealed_server_seed varchar;
