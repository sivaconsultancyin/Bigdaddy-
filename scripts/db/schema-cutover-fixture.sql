-- Minimal schema fixture for transactional schema-cutover CI.
-- No production data is loaded. The cutover migration must preserve table/view
-- shape and function boundaries against this catalogue fixture.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TYPE public.transaction_type_enum AS ENUM ('SYSTEM_INITIALIZATION','BET_ESCROW_LOCK');
CREATE TYPE public.wallet_type_enum AS ENUM ('TREASURY','PLAYER','GAME_POOL','ESCROW');
CREATE TYPE public.ledger_direction_enum AS ENUM ('DEBIT','CREDIT');
CREATE TYPE public.round_status_enum AS ENUM ('WAITING','RUNNING','CRASHED','SETTLED');
CREATE TYPE public.bet_status_enum AS ENUM ('PENDING','WON','LOST','CANCELLED');

CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text, email text, password_hash text, parent_id uuid, referred_by_user_id uuid, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, display_name text);
CREATE TABLE public.role_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role text);
CREATE TABLE public.referral_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, owner_user_id uuid, admin_id uuid, is_active boolean DEFAULT true);
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text);
CREATE TABLE public.token_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid, approver_id uuid, amount bigint, status text);
CREATE TABLE public.user_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.games (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, status text, pool_wallet_id uuid, min_bet bigint, max_bet bigint);
CREATE TABLE public.game_pools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_code text, wallet_id uuid);
CREATE TABLE public.wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, wallet_type public.wallet_type_enum, balance bigint NOT NULL DEFAULT 0, reserved_balance bigint NOT NULL DEFAULT 0, game_code text, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now());
CREATE TABLE public.wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text, type public.transaction_type_enum, amount bigint, source_wallet_id uuid, target_wallet_id uuid, metadata jsonb DEFAULT '{}'::jsonb, token_request_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.ledger_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid, wallet_id uuid, direction public.ledger_direction_enum, amount bigint, balance_after bigint, description text);
CREATE TABLE public.token_supply (id integer PRIMARY KEY, max_supply bigint, total_minted bigint);
CREATE TABLE public.game_rounds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_code text, round_number bigint, status public.round_status_enum);
CREATE TABLE public.game_bets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), round_id uuid, user_id uuid, bet_amount bigint, payout_amount bigint DEFAULT 0, status public.bet_status_enum DEFAULT 'PENDING');
CREATE TABLE public.game_settlements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bet_id uuid, round_id uuid, transaction_id uuid);
CREATE TABLE public.authoritative_game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text NOT NULL CHECK (game_code IN ('roulette','dice','dragon_tiger','andar_bahar')),
  round_number bigint NOT NULL CHECK (round_number > 0),
  status text NOT NULL DEFAULT 'BETTING' CHECK (status IN ('BETTING','RUNNING','RESULT','SETTLED','CANCELLED')),
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
CREATE TABLE public.authoritative_game_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.authoritative_game_rounds(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  bet_amount bigint NOT NULL CHECK (bet_amount > 0),
  selection jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','WON','LOST','CANCELLED')),
  payout_amount bigint NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
  reserved_liability bigint NOT NULL DEFAULT 0 CHECK (reserved_liability >= 0),
  idempotency_key text NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) >= 8),
  escrow_transaction_id uuid REFERENCES public.wallet_transactions(id),
  stake_release_transaction_id uuid REFERENCES public.wallet_transactions(id),
  payout_transaction_id uuid REFERENCES public.wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

-- Seed settled rows so CI proves the per-game split preserves history and IDs.
INSERT INTO public.users(id,username) VALUES ('20000000-0000-0000-0000-000000000001','fixture-player');
INSERT INTO public.authoritative_game_rounds
  (id,game_code,round_number,status,state,result,server_seed_hash,server_seed,opened_at,betting_closes_at,settled_at)
VALUES
  ('30000000-0000-0000-0000-000000000001','roulette',1,'SETTLED','{}','{"number":7,"color":"red"}','roulette-hash','roulette-seed',now()-interval '2 minutes',now()-interval '1 minute',now()),
  ('30000000-0000-0000-0000-000000000002','dice',1,'SETTLED','{}','{"number":5}','dice-hash','dice-seed',now()-interval '2 minutes',now()-interval '1 minute',now()),
  ('30000000-0000-0000-0000-000000000003','dragon_tiger',1,'SETTLED','{}','{"winner":"dragon"}','dragon-hash','dragon-seed',now()-interval '2 minutes',now()-interval '1 minute',now()),
  ('30000000-0000-0000-0000-000000000004','andar_bahar',1,'SETTLED','{}','{"winner":"andar"}','andar-hash','andar-seed',now()-interval '2 minutes',now()-interval '1 minute',now());
INSERT INTO public.authoritative_game_bets
  (id,round_id,user_id,bet_amount,selection,status,payout_amount,reserved_liability,idempotency_key)
VALUES
  ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',10,'{"type":"red"}','WON',20,0,'fixture-roulette-0001'),
  ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',10,'{"type":"odd"}','WON',20,0,'fixture-dice-0000001'),
  ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',10,'{"type":"dragon"}','WON',20,0,'fixture-dragontiger-01'),
  ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',10,'{"type":"andar"}','WON',20,0,'fixture-andarbahar-01');

CREATE FUNCTION public.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT gen_random_uuid() $$;
INSERT INTO public.wallets(id,wallet_type,balance,reserved_balance,game_code) VALUES
 ('00000000-0000-0000-0000-000000000001','GAME_POOL',1000266,0,'aviator'),
 ('00000000-0000-0000-0000-000000000002','GAME_POOL',0,0,'roulette'),
 ('00000000-0000-0000-0000-000000000003','GAME_POOL',0,0,'dice'),
 ('00000000-0000-0000-0000-000000000004','GAME_POOL',0,0,'dragon_tiger'),
 ('00000000-0000-0000-0000-000000000005','GAME_POOL',0,0,'andar_bahar');
INSERT INTO public.games(id,code,status,pool_wallet_id,min_bet,max_bet) VALUES
 ('10000000-0000-0000-0000-000000000001','aviator','ACTIVE','00000000-0000-0000-0000-000000000001',10,100000),
 ('10000000-0000-0000-0000-000000000002','roulette','COMING_SOON','00000000-0000-0000-0000-000000000001',10,100000),
 ('10000000-0000-0000-0000-000000000003','dice','COMING_SOON','00000000-0000-0000-0000-000000000001',10,100000),
 ('10000000-0000-0000-0000-000000000004','dragon_tiger','COMING_SOON','00000000-0000-0000-0000-000000000001',10,100000),
 ('10000000-0000-0000-0000-000000000005','andar_bahar','COMING_SOON','00000000-0000-0000-0000-000000000001',10,100000);
INSERT INTO public.game_pools(game_code,wallet_id) VALUES
 ('aviator','00000000-0000-0000-0000-000000000001'),
 ('roulette','00000000-0000-0000-0000-000000000001'),
 ('dice','00000000-0000-0000-0000-000000000001'),
 ('dragon_tiger','00000000-0000-0000-0000-000000000001'),
 ('andar_bahar','00000000-0000-0000-0000-000000000001');

CREATE SCHEMA wallet;
CREATE FUNCTION wallet.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT public.wallet_transfer_atomic($1,$2,$3,$4,$5,$6) $$;
CREATE FUNCTION public.place_crash_bet_atomic(uuid, uuid, bigint, text, numeric)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT gen_random_uuid() $$;
CREATE FUNCTION public.cashout_crash_bet_atomic(uuid, uuid, text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.settle_crash_round_atomic(uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT 0 $$;
