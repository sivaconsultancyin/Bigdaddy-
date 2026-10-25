-- Aviator isolated database foundation.
-- This database owns game rounds/bets/settlement intents only. User identity and wallet
-- balances remain in the shared platform/wallet service; do not add cross-database FKs.
BEGIN;

CREATE SCHEMA IF NOT EXISTS aviator;

CREATE TABLE IF NOT EXISTS aviator.game_rounds (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  game_code varchar(32) NOT NULL DEFAULT 'aviator' CHECK (game_code = 'aviator'),
  round_number bigint NOT NULL CHECK (round_number > 0),
  status text NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'RUNNING', 'CRASHED', 'SETTLED')),
  server_seed varchar(128) NOT NULL,
  client_seed varchar(128),
  server_seed_hash varchar(128) NOT NULL,
  crash_multiplier numeric(12,2) NOT NULL CHECK (crash_multiplier >= 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  revealed_server_seed varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aviator_game_rounds_game_round_unique UNIQUE (game_code, round_number)
);

CREATE TABLE IF NOT EXISTS aviator.game_bets (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  round_id uuid NOT NULL REFERENCES aviator.game_rounds(id),
  user_id uuid NOT NULL,
  bet_amount bigint NOT NULL CHECK (bet_amount > 0),
  auto_cashout numeric(12,2) CHECK (auto_cashout IS NULL OR auto_cashout BETWEEN 1.01 AND 50),
  cashed_out_at numeric(12,2),
  payout_amount bigint NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'WON', 'LOST', 'CANCELLED')),
  idempotency_key varchar(119) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aviator_game_bets_idempotency_unique UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS aviator.game_settlements (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  bet_id uuid NOT NULL UNIQUE REFERENCES aviator.game_bets(id),
  round_id uuid NOT NULL REFERENCES aviator.game_rounds(id),
  wallet_transaction_id uuid,
  payout_multiplier numeric(12,2) NOT NULL CHECK (payout_multiplier >= 1),
  net_win_amount bigint NOT NULL DEFAULT 0,
  settlement_status text NOT NULL DEFAULT 'PENDING'
    CHECK (settlement_status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY')),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  last_error_code varchar(80),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aviator.wallet_operations (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  bet_id uuid NOT NULL REFERENCES aviator.game_bets(id),
  operation_type text NOT NULL CHECK (operation_type IN ('DEBIT_BET', 'CREDIT_PAYOUT', 'REFUND_BET')),
  amount bigint NOT NULL CHECK (amount > 0),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY', 'FAILED')),
  wallet_transaction_id uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aviator_wallet_operations_bet_type_unique UNIQUE (bet_id, operation_type)
);

CREATE INDEX IF NOT EXISTS aviator_game_rounds_status_number_idx
  ON aviator.game_rounds (status, round_number DESC);
CREATE INDEX IF NOT EXISTS aviator_game_bets_round_status_idx
  ON aviator.game_bets (round_id, status, created_at);
CREATE INDEX IF NOT EXISTS aviator_game_bets_user_created_idx
  ON aviator.game_bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aviator_settlements_pending_idx
  ON aviator.game_settlements (settlement_status, created_at)
  WHERE settlement_status IN ('PENDING', 'RETRY');
CREATE INDEX IF NOT EXISTS aviator_wallet_operations_retry_idx
  ON aviator.wallet_operations (status, next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'RETRY');

ALTER TABLE aviator.game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE aviator.game_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE aviator.game_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE aviator.wallet_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA aviator FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA aviator TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA aviator FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA aviator TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aviator
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

COMMIT;
