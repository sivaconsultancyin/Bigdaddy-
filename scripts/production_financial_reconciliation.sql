-- BigDaddy production financial reconciliation (READ ONLY)
-- Run against Supabase SQL Editor using a trusted operator connection.
-- This file intentionally contains SELECT statements only; it does not repair balances,
-- release reservations, or modify migration history. Investigate discrepancies before
-- making any production data change.

-- 1) Token supply versus aggregate wallet balances.
SELECT
  (SELECT COALESCE(SUM(balance), 0) FROM public.wallets) AS wallet_balance_sum,
  (SELECT max_supply FROM public.token_supply WHERE id = 1) AS max_supply,
  (SELECT total_minted FROM public.token_supply WHERE id = 1) AS total_minted,
  ((SELECT COALESCE(SUM(balance), 0) FROM public.wallets)
    = (SELECT max_supply FROM public.token_supply WHERE id = 1)) AS wallet_sum_matches_supply;

-- 2) Find wallet transactions whose ledger entries do not balance.
-- Transactions without both a debit and a credit are surfaced as mismatches.
SELECT
  wt.id AS transaction_id,
  wt.idempotency_key,
  wt.type,
  wt.amount,
  COUNT(le.id) AS ledger_entry_count,
  COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'DEBIT'), 0) AS debit_total,
  COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'CREDIT'), 0) AS credit_total
FROM public.wallet_transactions wt
LEFT JOIN public.ledger_entries le ON le.transaction_id = wt.id
GROUP BY wt.id, wt.idempotency_key, wt.type, wt.amount
HAVING COUNT(le.id) <> 2
    OR COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'DEBIT'), 0)
       <> COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'CREDIT'), 0)
ORDER BY wt.created_at, wt.id;

-- 3) Compare each game pool's reserved balance with liabilities implied by PENDING bets.
-- Aviator bets without auto_cashout reserve against the maximum supported multiplier (50),
-- matching the current production function. Review all non-zero deltas before any repair.
SELECT
  g.code AS game_code,
  w.id AS pool_wallet_id,
  w.balance AS pool_balance,
  w.reserved_balance,
  COALESCE(b.pending_bets, 0) AS pending_bets,
  COALESCE(b.calculated_liability, 0) AS calculated_liability,
  w.reserved_balance - COALESCE(b.calculated_liability, 0) AS reservation_delta
FROM public.games g
JOIN public.wallets w ON w.id = g.pool_wallet_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE gb.status = 'PENDING') AS pending_bets,
    COALESCE(
      SUM(CEIL(gb.bet_amount::numeric * COALESCE(gb.auto_cashout, 50)))
        FILTER (WHERE gb.status = 'PENDING'),
      0
    )::bigint AS calculated_liability
  FROM public.game_bets gb
  JOIN public.game_rounds gr ON gr.id = gb.round_id
  WHERE gr.game_code = g.code
) b ON TRUE
ORDER BY g.code;

-- 4) Surface unfinished rounds and bets for manual restart/settlement review.
SELECT
  gr.game_code,
  gr.status AS round_status,
  COUNT(DISTINCT gr.id) AS round_count,
  COUNT(gb.id) FILTER (WHERE gb.status = 'PENDING') AS pending_bet_count
FROM public.game_rounds gr
LEFT JOIN public.game_bets gb ON gb.round_id = gr.id
WHERE gr.status IN ('WAITING', 'RUNNING', 'CRASHED')
   OR gb.status = 'PENDING'
GROUP BY gr.game_code, gr.status
ORDER BY gr.game_code, gr.status;
