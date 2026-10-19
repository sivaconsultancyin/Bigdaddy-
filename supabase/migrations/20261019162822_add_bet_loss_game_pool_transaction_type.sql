-- Track losing Crash stakes returned from escrow to the game's liquidity pool.
ALTER TYPE public.transaction_type_enum ADD VALUE IF NOT EXISTS 'BET_LOSS_GAME_POOL';
