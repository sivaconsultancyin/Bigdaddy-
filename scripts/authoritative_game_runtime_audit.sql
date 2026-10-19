-- Read-only audit for the authoritative game runtime. Run after staging migration/tests.
SELECT
  to_regclass('public.authoritative_game_rounds') IS NOT NULL AS rounds_table_exists,
  to_regclass('public.authoritative_game_bets') IS NOT NULL AS bets_table_exists;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('authoritative_game_rounds','authoritative_game_bets')
ORDER BY c.relname;

SELECT
  g.code,
  g.status AS game_status,
  w.balance AS pool_balance,
  w.reserved_balance AS pool_reserved_balance,
  COALESCE((
    SELECT sum(b.reserved_liability)
    FROM public.authoritative_game_bets b
    JOIN public.authoritative_game_rounds r ON r.id = b.round_id
    WHERE r.game_code = g.code AND b.status = 'PENDING'
  ), 0) AS pending_bet_liability,
  COALESCE((
    SELECT count(*)
    FROM public.authoritative_game_rounds r
    WHERE r.game_code = g.code AND r.status IN ('BETTING','RESULT')
  ), 0) AS unfinished_rounds
FROM public.games g
JOIN public.wallets w ON w.id = g.pool_wallet_id
WHERE g.code IN ('aviator','roulette','dice','dragon_tiger','andar_bahar')
ORDER BY g.code;

-- Any non-zero difference needs investigation before enabling a game.
SELECT
  g.code,
  w.reserved_balance AS wallet_reserved,
  COALESCE((
    SELECT sum(b.reserved_liability)
    FROM public.authoritative_game_bets b
    JOIN public.authoritative_game_rounds r ON r.id = b.round_id
    WHERE r.game_code = g.code AND b.status = 'PENDING'
  ), 0) AS pending_liability,
  w.reserved_balance - COALESCE((
    SELECT sum(b.reserved_liability)
    FROM public.authoritative_game_bets b
    JOIN public.authoritative_game_rounds r ON r.id = b.round_id
    WHERE r.game_code = g.code AND b.status = 'PENDING'
  ), 0) AS reservation_difference
FROM public.games g
JOIN public.wallets w ON w.id = g.pool_wallet_id
WHERE g.code IN ('roulette','dice','dragon_tiger','andar_bahar')
  AND w.reserved_balance <> COALESCE((
    SELECT sum(b.reserved_liability)
    FROM public.authoritative_game_bets b
    JOIN public.authoritative_game_rounds r ON r.id = b.round_id
    WHERE r.game_code = g.code AND b.status = 'PENDING'
  ), 0);

-- Existing Aviator reservation invariant.
SELECT
  g.code,
  w.reserved_balance AS wallet_reserved,
  COALESCE((
    SELECT sum(ceil(b.bet_amount::numeric * coalesce(b.auto_cashout, 50)))
    FROM public.game_bets b
    JOIN public.game_rounds r ON r.id = b.round_id
    WHERE r.game_code = 'aviator' AND b.status = 'PENDING'
  ), 0) AS pending_liability
FROM public.games g
JOIN public.wallets w ON w.id = g.pool_wallet_id
WHERE g.code = 'aviator';

-- Financial supply invariant: the runtime migration must not mint tokens.
SELECT
  (SELECT COALESCE(sum(balance),0) FROM public.wallets) AS total_wallet_balances,
  (SELECT max_supply FROM public.token_supply WHERE id = 1) AS max_supply,
  (SELECT total_minted FROM public.token_supply WHERE id = 1) AS total_minted;
