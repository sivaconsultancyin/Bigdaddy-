-- BigDaddy schema cutover preflight: READ-ONLY diagnostics.
-- Run against a staging clone first with psql -v ON_ERROR_STOP=1 -f this_file.sql.
-- This script deliberately performs no UPDATE/ALTER/DELETE and never moves funds.
\echo '1) Game catalog -> pool wallet mapping'
SELECT g.code AS game_code, g.status AS game_status, g.pool_wallet_id,
       w.game_code AS wallet_game_code, w.wallet_type, w.balance, w.reserved_balance
FROM public.games g
LEFT JOIN public.wallets w ON w.id = g.pool_wallet_id
ORDER BY g.code;

\echo '2) Game-pool mapping rows and duplicate wallet assignments'
SELECT gp.game_code, gp.wallet_id, w.game_code AS wallet_game_code,
       w.balance, w.reserved_balance
FROM public.game_pools gp
LEFT JOIN public.wallets w ON w.id = gp.wallet_id
ORDER BY gp.game_code;

SELECT wallet_id, count(*) AS mapped_game_count,
       array_agg(game_code ORDER BY game_code) AS mapped_games
FROM public.game_pools
GROUP BY wallet_id
HAVING count(*) > 1
ORDER BY mapped_game_count DESC;

\echo '3) Pool wallet totals and reservation sanity'
SELECT id, game_code, balance, reserved_balance,
       balance - reserved_balance AS available_balance,
       (reserved_balance > balance) AS reservation_exceeds_balance
FROM public.wallets
WHERE wallet_type = 'GAME_POOL'::public.wallet_type_enum
ORDER BY game_code NULLS FIRST, created_at;

\echo '4) Open Aviator bets and rounds (must be settled/reconciled before cutover)'
SELECT status, count(*) AS bet_count,
       COALESCE(sum(bet_amount),0) AS total_stake,
       COALESCE(sum(payout_amount),0) AS recorded_payout
FROM public.game_bets
GROUP BY status
ORDER BY status;

SELECT status, count(*) AS round_count
FROM public.game_rounds
WHERE game_code = 'aviator'
GROUP BY status
ORDER BY status;

\echo '5) Open authoritative-game bets by game (if migration is installed)'
SELECT r.game_code, b.status, count(*) AS bet_count,
       COALESCE(sum(b.bet_amount),0) AS total_stake,
       COALESCE(sum(b.reserved_liability),0) AS reserved_liability
FROM public.authoritative_game_bets b
JOIN public.authoritative_game_rounds r ON r.id = b.round_id
WHERE b.status = 'PENDING'
GROUP BY r.game_code, b.status
ORDER BY r.game_code;

\echo '6) Ledger entries grouped by transaction (non-zero net is a reconciliation exception)'
SELECT le.transaction_id,
       sum(CASE WHEN le.direction::text = 'CREDIT' THEN le.amount
                WHEN le.direction::text = 'DEBIT' THEN -le.amount ELSE 0 END) AS net_amount,
       count(*) AS entry_count
FROM public.ledger_entries le
GROUP BY le.transaction_id
HAVING sum(CASE WHEN le.direction::text = 'CREDIT' THEN le.amount
                WHEN le.direction::text = 'DEBIT' THEN -le.amount ELSE 0 END) <> 0
ORDER BY le.transaction_id;

\echo '7) Schema cutover inventory: current public tables and intended destination'
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users','user_profiles','role_assignments','referral_codes','wallets',
    'wallet_transactions','ledger_entries','token_supply','games','game_pools',
    'game_rounds','game_bets','authoritative_game_rounds','authoritative_game_bets'
  )
ORDER BY tablename;
