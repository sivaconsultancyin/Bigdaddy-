-- ============================================================================
-- BIGDADDY CASINO — INITIAL DATABASE SEED SCRIPT
-- ============================================================================
-- Initializes:
-- 1. Fixed Token Supply Record (10,000,000,000 tokens)
-- 2. System Wallets (Treasury, Bet Escrow, Dedicated Game Pools)
-- 3. Initial Ledger Entries (Crediting Treasury with 10,000,000,000 tokens)
-- ============================================================================

BEGIN;

-- 1. Initialize Fixed Master Token Supply
INSERT INTO token_supply (id, max_supply, total_minted, initialized_at)
VALUES (1, 10000000000, 10000000000, NOW())
ON CONFLICT (id) DO NOTHING;

-- 2. Provision System Wallets
-- Owner Treasury Wallet
INSERT INTO wallets (id, user_id, wallet_type, game_code, balance, reserved_balance, created_at)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, NULL, 'TREASURY', NULL, 10000000000, 0, NOW())
ON CONFLICT (id) DO NOTHING;

-- Escrow Wallet
INSERT INTO wallets (id, user_id, wallet_type, game_code, balance, reserved_balance, created_at)
VALUES ('00000000-0000-0000-0000-000000000002'::uuid, NULL, 'ESCROW', NULL, 0, 0, NOW())
ON CONFLICT (id) DO NOTHING;

-- Dedicated Game Pools
INSERT INTO wallets (id, user_id, wallet_type, game_code, balance, reserved_balance, created_at)
VALUES 
('00000000-0000-0000-0000-000000000010'::uuid, NULL, 'GAME_POOL', 'aviator', 0, 0, NOW()),
('00000000-0000-0000-0000-000000000011'::uuid, NULL, 'GAME_POOL', 'roulette', 0, 0, NOW()),
('00000000-0000-0000-0000-000000000012'::uuid, NULL, 'GAME_POOL', 'teen-patti', 0, 0, NOW()),
('00000000-0000-0000-0000-000000000013'::uuid, NULL, 'GAME_POOL', 'dice', 0, 0, NOW()),
('00000000-0000-0000-0000-000000000014'::uuid, NULL, 'GAME_POOL', 'dragon-tiger', 0, 0, NOW()),
('00000000-0000-0000-0000-000000000015'::uuid, NULL, 'GAME_POOL', 'andar-bahar', 0, 0, NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. Register Games
INSERT INTO games (id, code, name, status, pool_wallet_id, min_bet, max_bet)
VALUES
('00000000-0000-0000-0000-000000000101'::uuid, 'aviator', 'Aviator / Crash', 'ACTIVE', '00000000-0000-0000-0000-000000000010'::uuid, 10, 100000),
('00000000-0000-0000-0000-000000000102'::uuid, 'roulette', 'European Roulette', 'COMING_SOON', '00000000-0000-0000-0000-000000000011'::uuid, 50, 250000),
('00000000-0000-0000-0000-000000000103'::uuid, 'teen-patti', 'Teen Patti', 'COMING_SOON', '00000000-0000-0000-0000-000000000012'::uuid, 100, 500000),
('00000000-0000-0000-0000-000000000104'::uuid, 'dice', 'Provably Fair Dice', 'COMING_SOON', '00000000-0000-0000-0000-000000000013'::uuid, 10, 100000),
('00000000-0000-0000-0000-000000000105'::uuid, 'dragon-tiger', 'Dragon Tiger', 'COMING_SOON', '00000000-0000-0000-0000-000000000014'::uuid, 50, 300000),
('00000000-0000-0000-0000-000000000106'::uuid, 'andar-bahar', 'Andar Bahar', 'COMING_SOON', '00000000-0000-0000-0000-000000000015'::uuid, 50, 200000)
ON CONFLICT (id) DO NOTHING;

-- 4. Initial Double-Entry Master Ledger Record
INSERT INTO wallet_transactions (id, idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata)
VALUES ('00000000-0000-0000-0000-000000000201'::uuid, 'TX_GENESIS_INITIALIZATION', 'SYSTEM_INITIALIZATION', 10000000000, NULL, '00000000-0000-0000-0000-000000000001'::uuid, '{"note": "Genesis 10 Billion Token Allocation"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (transaction_id, wallet_id, direction, amount, balance_after, description)
VALUES ('00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'CREDIT', 10000000000, 10000000000, 'Genesis token supply minted to Owner Treasury')
ON CONFLICT DO NOTHING;

COMMIT;
