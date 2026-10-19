-- BigDaddy Casino production database bootstrap.
-- This migration refuses to seed over existing wallet data.
BEGIN;

DO $bootstrap$
DECLARE
  v_treasury constant uuid := '00000000-0000-4000-8000-000000000001';
  v_escrow constant uuid := '00000000-0000-4000-8000-000000000002';
  v_crash_pool constant uuid := '00000000-0000-4000-8000-000000000003';
  v_tx uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallets) THEN
    RAISE EXCEPTION 'Bootstrap aborted: wallets table is not empty; reconcile existing balances before seeding.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.token_supply WHERE id = 1) THEN
    RAISE EXCEPTION 'Bootstrap aborted: token_supply is already initialized.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_transactions) THEN
    RAISE EXCEPTION 'Bootstrap aborted: wallet transaction history already exists.';
  END IF;

  INSERT INTO public.token_supply (id, max_supply, total_minted)
  VALUES (1, 10000000000, 10000000000);

  INSERT INTO public.wallets (id, user_id, wallet_type, game_code, balance, reserved_balance)
  VALUES
    (v_treasury, NULL, 'TREASURY', NULL, 10000000000, 0),
    (v_escrow, NULL, 'ESCROW', NULL, 0, 0),
    (v_crash_pool, NULL, 'GAME_POOL', 'aviator', 0, 0);

  INSERT INTO public.wallet_transactions
    (idempotency_key, type, amount, source_wallet_id, target_wallet_id, metadata)
  VALUES
    ('GENESIS_MINT', 'SYSTEM_INITIALIZATION', 10000000000, NULL, v_treasury,
     jsonb_build_object('reason', 'Fixed 10 billion token supply bootstrap', 'source', 'database_migration'))
  RETURNING id INTO v_tx;

  INSERT INTO public.ledger_entries
    (transaction_id, wallet_id, direction, amount, balance_after, description)
  VALUES
    (v_tx, v_treasury, 'CREDIT', 10000000000, 10000000000,
     'Genesis allocation: fixed token supply to Owner Treasury');

  INSERT INTO public.games (code, name, status, pool_wallet_id, min_bet, max_bet, config)
  VALUES ('aviator', 'Crash', 'COMING_SOON', v_crash_pool, 10, 100000,
          jsonb_build_object('server_authoritative', true, 'enabled_after_verification', true));

  INSERT INTO public.game_pools (game_code, wallet_id, allocated_by)
  VALUES ('aviator', v_crash_pool, NULL);
END
$bootstrap$;

-- Custom backend JWTs are used by this application, not Supabase Auth JWTs.
-- Browser roles receive no direct table privileges; trusted backend PostgreSQL
-- connections perform validated operations. Restrictive false policies ensure
-- accidental future grants cannot expose these private tables to browser roles.
REVOKE ALL ON TABLE
  public.audit_logs,
  public.game_bets,
  public.game_pools,
  public.game_rounds,
  public.game_settlements,
  public.games,
  public.ledger_entries,
  public.referral_codes,
  public.role_assignments,
  public.token_requests,
  public.token_supply,
  public.user_profiles,
  public.user_sessions,
  public.users,
  public.wallet_transactions,
  public.wallets
FROM anon, authenticated;

CREATE POLICY deny_browser_access ON public.audit_logs AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.game_bets AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.game_pools AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.game_rounds AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.game_settlements AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.games AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.ledger_entries AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.referral_codes AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.role_assignments AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.token_requests AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.token_supply AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.user_profiles AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.user_sessions AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.users AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.wallet_transactions AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_browser_access ON public.wallets AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMIT;
