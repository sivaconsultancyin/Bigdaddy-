-- Production schema cutover with compatibility views.
-- The entire DDL operation is transactional. Balances/rows are not copied or changed.
-- Stop conditions are intentional: do not run while bets/rounds are open or financial
-- reconciliation contains unexplained imbalance.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_bets WHERE status::text = 'PENDING') THEN
    RAISE EXCEPTION 'Schema cutover blocked: pending Aviator bets exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE status::text IN ('WAITING','RUNNING')) THEN
    RAISE EXCEPTION 'Schema cutover blocked: live Aviator rounds exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.authoritative_game_bets WHERE status::text = 'PENDING') THEN
    RAISE EXCEPTION 'Schema cutover blocked: pending authoritative-game bets exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.authoritative_game_rounds WHERE status::text IN ('BETTING','RUNNING','RESULT')) THEN
    RAISE EXCEPTION 'Schema cutover blocked: active authoritative-game rounds exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets WHERE reserved_balance > balance) THEN
    RAISE EXCEPTION 'Schema cutover blocked: a wallet reservation exceeds balance';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wallet_transactions wt
    JOIN public.ledger_entries le ON le.transaction_id = wt.id
    GROUP BY wt.id, wt.type
    HAVING sum(CASE WHEN le.direction::text = 'CREDIT' THEN le.amount
                    WHEN le.direction::text = 'DEBIT' THEN -le.amount ELSE 0 END) <> 0
       AND wt.type::text <> 'SYSTEM_INITIALIZATION'
  ) THEN
    RAISE EXCEPTION 'Schema cutover blocked: unexplained non-initialization ledger imbalance exists';
  END IF;
END
$preflight$;

-- Reassert namespace permissions in case the namespace-preparation migration
-- was applied out of band or the migration ledger is behind.
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS wallet;
CREATE SCHEMA IF NOT EXISTS aviator;
CREATE SCHEMA IF NOT EXISTS roulette;
CREATE SCHEMA IF NOT EXISTS dice;
CREATE SCHEMA IF NOT EXISTS dragon_tiger;
CREATE SCHEMA IF NOT EXISTS andar_bahar;
CREATE SCHEMA IF NOT EXISTS teen_patti;
REVOKE ALL ON SCHEMA platform, wallet, aviator, roulette, dice, dragon_tiger, andar_bahar, teen_patti FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA platform, wallet, aviator, roulette, dice, dragon_tiger, andar_bahar, teen_patti TO service_role;

-- Move shared platform/configuration tables. Foreign keys retain their object OIDs.
ALTER TABLE public.users SET SCHEMA platform;
ALTER TABLE public.user_profiles SET SCHEMA platform;
ALTER TABLE public.role_assignments SET SCHEMA platform;
ALTER TABLE public.referral_codes SET SCHEMA platform;
ALTER TABLE public.audit_logs SET SCHEMA platform;
ALTER TABLE public.token_requests SET SCHEMA platform;
ALTER TABLE public.user_sessions SET SCHEMA platform;
ALTER TABLE public.games SET SCHEMA platform;
ALTER TABLE public.game_pools SET SCHEMA platform;

-- Central wallet and accounting tables. Keep public enum types in place for
-- compatibility with existing API payloads and function signatures.
ALTER TABLE public.wallets SET SCHEMA wallet;
ALTER TABLE public.wallet_transactions SET SCHEMA wallet;
ALTER TABLE public.ledger_entries SET SCHEMA wallet;
ALTER TABLE public.token_supply SET SCHEMA wallet;

-- Aviator-owned runtime tables.
ALTER TABLE public.game_rounds SET SCHEMA aviator;
ALTER TABLE public.game_bets SET SCHEMA aviator;
ALTER TABLE public.game_settlements SET SCHEMA aviator;

-- Reconcile the historical shared-pool pointer without moving any funds.
-- Aviator remains on its existing pool. Non-Aviator games are currently
-- COMING_SOON and each has its own zero-balance pool wallet; restore those
-- pointers so activating a game cannot silently spend from the Aviator pool.
DO $pool_reconcile$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform.games g
    WHERE g.code <> 'aviator' AND g.status::text = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM wallet.wallets shared_pool
        WHERE shared_pool.id = g.pool_wallet_id
          AND shared_pool.wallet_type::text = 'GAME_POOL'
          AND shared_pool.game_code = 'aviator'
      )
  ) THEN
    RAISE EXCEPTION 'Pool reconciliation blocked: a non-Aviator game is ACTIVE on the Aviator pool';
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform.games g
    WHERE g.code <> 'aviator' AND g.status::text = 'COMING_SOON'
      AND NOT EXISTS (
        SELECT 1 FROM wallet.wallets own_pool
        WHERE own_pool.wallet_type::text = 'GAME_POOL'
          AND own_pool.game_code = g.code
      )
  ) THEN
    RAISE EXCEPTION 'Pool reconciliation blocked: a coming-soon game has no dedicated pool wallet';
  END IF;
END
$pool_reconcile$;

UPDATE platform.games g
SET pool_wallet_id = w.id
FROM wallet.wallets w
WHERE g.code <> 'aviator'
  AND g.status::text = 'COMING_SOON'
  AND w.wallet_type::text = 'GAME_POOL'
  AND w.game_code = g.code
  AND g.pool_wallet_id IS DISTINCT FROM w.id;

UPDATE platform.game_pools gp
SET wallet_id = w.id
FROM wallet.wallets w
WHERE gp.game_code <> 'aviator'
  AND w.wallet_type::text = 'GAME_POOL'
  AND w.game_code = gp.game_code
  AND gp.wallet_id IS DISTINCT FROM w.id;

-- Move the implementation of wallet_transfer_atomic into the wallet namespace.
-- Preserve a public compatibility function for any still-deployed callers.
ALTER FUNCTION wallet.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb)
  RENAME TO wallet_transfer_atomic_legacy;
ALTER FUNCTION public.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb)
  SET SCHEMA wallet;
DROP FUNCTION wallet.wallet_transfer_atomic_legacy(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb);

CREATE FUNCTION public.wallet_transfer_atomic(
  p_idempotency_key text,
  p_type public.transaction_type_enum,
  p_amount bigint,
  p_source_wallet_id uuid,
  p_target_wallet_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT wallet.wallet_transfer_atomic(
    p_idempotency_key, p_type, p_amount, p_source_wallet_id, p_target_wallet_id, p_metadata
  );
$function$;

-- Move the crash-game function implementations and retain service-only public
-- wrappers during the application rollout.
ALTER FUNCTION public.place_crash_bet_atomic(uuid, uuid, bigint, text, numeric) SET SCHEMA aviator;
ALTER FUNCTION public.cashout_crash_bet_atomic(uuid, uuid, text) SET SCHEMA aviator;
ALTER FUNCTION public.settle_crash_round_atomic(uuid) SET SCHEMA aviator;

CREATE FUNCTION public.place_crash_bet_atomic(
  p_user_id uuid, p_round_id uuid, p_amount bigint, p_idempotency_key text, p_auto_cashout numeric
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $function$ SELECT aviator.place_crash_bet_atomic(p_user_id,p_round_id,p_amount,p_idempotency_key,p_auto_cashout); $function$;

CREATE FUNCTION public.cashout_crash_bet_atomic(
  p_user_id uuid, p_bet_id uuid, p_idempotency_key text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $function$ SELECT aviator.cashout_crash_bet_atomic(p_user_id,p_bet_id,p_idempotency_key); $function$;

CREATE FUNCTION public.settle_crash_round_atomic(p_round_id uuid)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $function$ SELECT aviator.settle_crash_round_atomic(p_round_id); $function$;

-- Public compatibility views are simple/updatable one-table views. Browser roles
-- cannot access them; backend service_role can continue working during rollout.
CREATE VIEW public.users AS SELECT * FROM platform.users;
CREATE VIEW public.user_profiles AS SELECT * FROM platform.user_profiles;
CREATE VIEW public.role_assignments AS SELECT * FROM platform.role_assignments;
CREATE VIEW public.referral_codes AS SELECT * FROM platform.referral_codes;
CREATE VIEW public.audit_logs AS SELECT * FROM platform.audit_logs;
CREATE VIEW public.token_requests AS SELECT * FROM platform.token_requests;
CREATE VIEW public.user_sessions AS SELECT * FROM platform.user_sessions;
CREATE VIEW public.games AS SELECT * FROM platform.games;
CREATE VIEW public.game_pools AS SELECT * FROM platform.game_pools;
CREATE VIEW public.wallets AS SELECT * FROM wallet.wallets;
CREATE VIEW public.wallet_transactions AS SELECT * FROM wallet.wallet_transactions;
CREATE VIEW public.ledger_entries AS SELECT * FROM wallet.ledger_entries;
CREATE VIEW public.token_supply AS SELECT * FROM wallet.token_supply;
CREATE VIEW public.game_rounds AS SELECT * FROM aviator.game_rounds;
CREATE VIEW public.game_bets AS SELECT * FROM aviator.game_bets;
CREATE VIEW public.game_settlements AS SELECT * FROM aviator.game_settlements;

REVOKE ALL ON public.users, public.user_profiles, public.role_assignments, public.referral_codes,
  public.audit_logs, public.token_requests, public.user_sessions, public.games, public.game_pools,
  public.wallets, public.wallet_transactions, public.ledger_entries, public.token_supply,
  public.game_rounds, public.game_bets, public.game_settlements
FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users, public.user_profiles, public.role_assignments,
  public.referral_codes, public.audit_logs, public.token_requests, public.user_sessions,
  public.games, public.game_pools, public.wallets, public.wallet_transactions, public.ledger_entries,
  public.token_supply, public.game_rounds, public.game_bets, public.game_settlements TO service_role;

REVOKE ALL ON FUNCTION wallet.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wallet.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_atomic(text, public.transaction_type_enum, bigint, uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION aviator.place_crash_bet_atomic(uuid, uuid, bigint, text, numeric),
  aviator.cashout_crash_bet_atomic(uuid, uuid, text), aviator.settle_crash_round_atomic(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aviator.place_crash_bet_atomic(uuid, uuid, bigint, text, numeric),
  aviator.cashout_crash_bet_atomic(uuid, uuid, text), aviator.settle_crash_round_atomic(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.place_crash_bet_atomic(uuid, uuid, bigint, text, numeric),
  public.cashout_crash_bet_atomic(uuid, uuid, text), public.settle_crash_round_atomic(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_crash_bet_atomic(uuid, uuid, bigint, text, numeric),
  public.cashout_crash_bet_atomic(uuid, uuid, text), public.settle_crash_round_atomic(uuid) TO service_role;

-- Backend service role keeps direct access; browser roles get no grants on the moved tables.
REVOKE ALL ON platform.users, platform.user_profiles, platform.role_assignments, platform.referral_codes,
  platform.audit_logs, platform.token_requests, platform.user_sessions, platform.games, platform.game_pools,
  wallet.wallets, wallet.wallet_transactions, wallet.ledger_entries, wallet.token_supply,
  aviator.game_rounds, aviator.game_bets, aviator.game_settlements
FROM PUBLIC, anon, authenticated;
GRANT ALL ON platform.users, platform.user_profiles, platform.role_assignments, platform.referral_codes,
  platform.audit_logs, platform.token_requests, platform.user_sessions, platform.games, platform.game_pools,
  wallet.wallets, wallet.wallet_transactions, wallet.ledger_entries, wallet.token_supply,
  aviator.game_rounds, aviator.game_bets, aviator.game_settlements TO service_role;

COMMIT;
