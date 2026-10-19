-- The schema already has a unique constraint on (game_code, round_number).
-- Remove the redundant standalone unique index created by the first financial migration.
DROP INDEX IF EXISTS public.game_rounds_game_code_round_number_uidx;
