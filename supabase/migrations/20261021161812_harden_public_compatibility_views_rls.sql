BEGIN;
ALTER VIEW public.audit_logs SET (security_invoker = true);
ALTER VIEW public.authoritative_game_bets SET (security_invoker = true);
ALTER VIEW public.authoritative_game_rounds SET (security_invoker = true);
ALTER VIEW public.game_bets SET (security_invoker = true);
ALTER VIEW public.game_pools SET (security_invoker = true);
ALTER VIEW public.game_rounds SET (security_invoker = true);
ALTER VIEW public.game_settlements SET (security_invoker = true);
ALTER VIEW public.games SET (security_invoker = true);
ALTER VIEW public.ledger_entries SET (security_invoker = true);
ALTER VIEW public.referral_codes SET (security_invoker = true);
ALTER VIEW public.role_assignments SET (security_invoker = true);
ALTER VIEW public.token_requests SET (security_invoker = true);
ALTER VIEW public.token_supply SET (security_invoker = true);
ALTER VIEW public.user_profiles SET (security_invoker = true);
ALTER VIEW public.user_sessions SET (security_invoker = true);
ALTER VIEW public.users SET (security_invoker = true);
ALTER VIEW public.wallet_transactions SET (security_invoker = true);
ALTER VIEW public.wallets SET (security_invoker = true);
REVOKE ALL ON public.audit_logs, public.authoritative_game_bets, public.authoritative_game_rounds,
 public.game_bets, public.game_pools, public.game_rounds, public.game_settlements, public.games,
 public.ledger_entries, public.referral_codes, public.role_assignments, public.token_requests,
 public.token_supply, public.user_profiles, public.user_sessions, public.users, public.wallet_transactions,
 public.wallets FROM PUBLIC, anon, authenticated;
COMMIT;