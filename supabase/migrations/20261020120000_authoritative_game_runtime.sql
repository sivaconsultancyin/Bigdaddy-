-- Persistent round/bet ledger for server-authoritative non-crash games.
-- This migration is intentionally NOT applied to production by this workflow.
CREATE TABLE IF NOT EXISTS public.authoritative_game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text NOT NULL CHECK (game_code IN ('roulette','dice','dragon_tiger','andar_bahar')),
  round_number bigint NOT NULL CHECK (round_number > 0),
  status text NOT NULL DEFAULT 'BETTING'
    CHECK (status IN ('BETTING','RUNNING','RESULT','SETTLED','CANCELLED')),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  server_seed_hash text NOT NULL,
  server_seed text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  betting_closes_at timestamptz NOT NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_code, round_number),
  CHECK (betting_closes_at > opened_at)
);

CREATE INDEX IF NOT EXISTS idx_authoritative_rounds_current
  ON public.authoritative_game_rounds (game_code, status, round_number DESC);
CREATE INDEX IF NOT EXISTS idx_authoritative_rounds_history
  ON public.authoritative_game_rounds (game_code, settled_at DESC)
  WHERE status = 'SETTLED';

CREATE TABLE IF NOT EXISTS public.authoritative_game_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.authoritative_game_rounds(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  bet_amount bigint NOT NULL CHECK (bet_amount > 0),
  selection jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','WON','LOST','CANCELLED')),
  payout_amount bigint NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
  reserved_liability bigint NOT NULL DEFAULT 0 CHECK (reserved_liability >= 0),
  idempotency_key text NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) >= 8),
  escrow_transaction_id uuid REFERENCES public.wallet_transactions(id),
  stake_release_transaction_id uuid REFERENCES public.wallet_transactions(id),
  payout_transaction_id uuid REFERENCES public.wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_authoritative_bets_round_status
  ON public.authoritative_game_bets (round_id, status);
CREATE INDEX IF NOT EXISTS idx_authoritative_bets_user_created
  ON public.authoritative_game_bets (user_id, created_at DESC);

ALTER TABLE public.authoritative_game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authoritative_game_bets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.authoritative_game_rounds FROM anon, authenticated;
REVOKE ALL ON public.authoritative_game_bets FROM anon, authenticated;

COMMENT ON TABLE public.authoritative_game_rounds IS
  'Durable server-owned round lifecycle/results for Roulette, Dice, Dragon Tiger, and Andar Bahar.';
COMMENT ON TABLE public.authoritative_game_bets IS
  'Durable server-validated bets and settlement transaction references; no client writes.';
