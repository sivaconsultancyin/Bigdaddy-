-- ============================================================================
-- BIGDADDY CASINO — PRODUCTION RELATIONAL DATABASE SCHEMA (PostgreSQL / Supabase)
-- ============================================================================
-- Features:
-- - Strict Double-Entry Ledger for All Financial Operations
-- - Fixed 10,000,000,000 Total Token Supply Invariant
-- - Hierarchical RBAC (OWNER -> SUPER_ADMIN -> ADMIN -> PLAYER)
-- - Independent Game Pools, Bet Escrow, and Authoritative Settlements
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS & IDENTITY
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    referred_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_parent_id ON users(parent_id);
CREATE INDEX idx_users_referred_by ON users(referred_by_user_id);
CREATE INDEX idx_users_username ON users(username);

-- 2. USER PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    phone VARCHAR(30),
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. ROLE ASSIGNMENTS
CREATE TYPE user_role_enum AS ENUM ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'PLAYER');

CREATE TABLE IF NOT EXISTS role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL,
    assigned_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_role_assignments_role ON role_assignments(role);

-- 4. REFERRAL CODES
CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) UNIQUE NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_codes_owner ON referral_codes(owner_user_id);

-- 5. TOKEN SUPPLY MASTER INVARIANT (Exactly One Row with 10 Billion Max)
CREATE TABLE IF NOT EXISTS token_supply (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_supply BIGINT NOT NULL CHECK (max_supply = 10000000000),
    total_minted BIGINT NOT NULL CHECK (total_minted = 10000000000),
    initialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. WALLETS (Treasury, Role Wallets, Game Pools, Escrow)
CREATE TYPE wallet_type_enum AS ENUM ('TREASURY', 'SUPER_ADMIN', 'ADMIN', 'PLAYER', 'GAME_POOL', 'ESCROW');

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    wallet_type wallet_type_enum NOT NULL,
    game_code VARCHAR(50),
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    reserved_balance BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_wallet_user_type CHECK (
        (wallet_type IN ('TREASURY', 'GAME_POOL', 'ESCROW') AND user_id IS NULL) OR
        (wallet_type IN ('SUPER_ADMIN', 'ADMIN', 'PLAYER') AND user_id IS NOT NULL)
    )
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_type ON wallets(wallet_type);
CREATE INDEX idx_wallets_game_code ON wallets(game_code);

-- 7. TOKEN REQUESTS
CREATE TYPE token_request_status_enum AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS token_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL CHECK (amount > 0),
    status token_request_status_enum NOT NULL DEFAULT 'PENDING',
    requester_note TEXT,
    decision_note TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_requests_requester ON token_requests(requester_id);
CREATE INDEX idx_token_requests_approver ON token_requests(approver_id);
CREATE INDEX idx_token_requests_status ON token_requests(status);

-- 8. WALLET TRANSACTIONS (Financial Transfer Headers)
CREATE TYPE transaction_type_enum AS ENUM (
    'SYSTEM_INITIALIZATION',
    'TREASURY_TO_ROLE',
    'ROLE_TO_ROLE',
    'ROLE_TO_PLAYER',
    'TOKEN_REQUEST_APPROVAL',
    'POOL_ALLOCATION',
    'BET_ESCROW_LOCK',
    'BET_ESCROW_REFUND',
    'BET_WIN_PAYOUT',
    'BET_LOSS_TREASURY'
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    type transaction_type_enum NOT NULL,
    amount BIGINT NOT NULL CHECK (amount >= 0),
    source_wallet_id UUID REFERENCES wallets(id),
    target_wallet_id UUID REFERENCES wallets(id),
    token_request_id UUID REFERENCES token_requests(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_idempotency ON wallet_transactions(idempotency_key);
CREATE INDEX idx_wallet_tx_source ON wallet_transactions(source_wallet_id);
CREATE INDEX idx_wallet_tx_target ON wallet_transactions(target_wallet_id);

-- 9. IMMUTABLE DOUBLE-ENTRY LEDGER (Debits and Credits)
CREATE TYPE ledger_direction_enum AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    direction ledger_direction_enum NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX idx_ledger_created_at ON ledger_entries(created_at);

-- 10. GAMES REGISTRY
CREATE TYPE game_status_enum AS ENUM ('ACTIVE', 'MAINTENANCE', 'COMING_SOON');

CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    status game_status_enum NOT NULL DEFAULT 'COMING_SOON',
    pool_wallet_id UUID NOT NULL REFERENCES wallets(id),
    min_bet BIGINT NOT NULL DEFAULT 10 CHECK (min_bet > 0),
    max_bet BIGINT NOT NULL DEFAULT 100000 CHECK (max_bet >= min_bet),
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. GAME POOLS (Metadata link)
CREATE TABLE IF NOT EXISTS game_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_code VARCHAR(50) UNIQUE NOT NULL,
    wallet_id UUID UNIQUE NOT NULL REFERENCES wallets(id),
    allocated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. GAME ROUNDS
CREATE TYPE round_status_enum AS ENUM ('WAITING', 'RUNNING', 'CRASHED', 'SETTLED');

CREATE TABLE IF NOT EXISTS game_rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_code VARCHAR(50) NOT NULL,
    round_number BIGINT NOT NULL,
    status round_status_enum NOT NULL DEFAULT 'WAITING',
    server_seed VARCHAR(128) NOT NULL,
    client_seed VARCHAR(128),
    crash_multiplier NUMERIC(8, 2),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    UNIQUE (game_code, round_number)
);

CREATE INDEX idx_game_rounds_code_status ON game_rounds(game_code, status);

-- 13. GAME BETS
CREATE TYPE bet_status_enum AS ENUM ('PENDING', 'WON', 'LOST', 'CANCELLED');

CREATE TABLE IF NOT EXISTS game_bets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id UUID NOT NULL REFERENCES game_rounds(id),
    user_id UUID NOT NULL REFERENCES users(id),
    bet_amount BIGINT NOT NULL CHECK (bet_amount > 0),
    auto_cashout NUMERIC(8, 2),
    cashed_out_at NUMERIC(8, 2),
    payout_amount BIGINT DEFAULT 0 CHECK (payout_amount >= 0),
    status bet_status_enum NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_bets_round ON game_bets(round_id);
CREATE INDEX idx_game_bets_user ON game_bets(user_id);
CREATE INDEX idx_game_bets_status ON game_bets(status);

-- 14. GAME SETTLEMENTS
CREATE TABLE IF NOT EXISTS game_settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bet_id UUID UNIQUE NOT NULL REFERENCES game_bets(id),
    round_id UUID NOT NULL REFERENCES game_rounds(id),
    transaction_id UUID NOT NULL REFERENCES wallet_transactions(id),
    payout_multiplier NUMERIC(8, 2) NOT NULL,
    net_win_amount BIGINT NOT NULL DEFAULT 0,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at);

-- 16. AUTH SESSIONS / REFRESH TOKENS
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(45),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
