-- Production hardening for BigDaddy's server-only Supabase schema.
-- Browser clients must not invoke administrative SECURITY DEFINER helpers.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;

-- Cover foreign-key lookups reported by Supabase's database advisor.
CREATE INDEX IF NOT EXISTS idx_game_pools_allocated_by
  ON public.game_pools (allocated_by);
CREATE INDEX IF NOT EXISTS idx_game_settlements_round_id
  ON public.game_settlements (round_id);
CREATE INDEX IF NOT EXISTS idx_game_settlements_transaction_id
  ON public.game_settlements (transaction_id);
CREATE INDEX IF NOT EXISTS idx_games_pool_wallet_id
  ON public.games (pool_wallet_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_admin_id
  ON public.referral_codes (admin_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_assigned_by
  ON public.role_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_token_request_id
  ON public.wallet_transactions (token_request_id);

-- RLS remains enabled without client policies intentionally: app data is
-- accessed through the trusted backend's PostgreSQL connection, not browser
-- Supabase keys. Add narrowly scoped policies only if a direct-client use case
-- is explicitly designed and security-reviewed.
