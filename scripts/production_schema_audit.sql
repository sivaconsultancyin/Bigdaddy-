-- BigDaddy production schema audit (READ ONLY)
-- Run in Supabase SQL Editor using an operator connection. SELECT statements only.
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_tables,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public') AS public_columns,
  (SELECT COUNT(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f') AS foreign_keys,
  (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public') AS indexes,
  (SELECT COUNT(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) AS unvalidated_constraints,
  (SELECT COUNT(*) FROM pg_index ix JOIN pg_class ic ON ic.oid=ix.indexrelid JOIN pg_namespace n ON n.oid=ic.relnamespace WHERE n.nspname='public' AND NOT ix.indisvalid) AS invalid_indexes;

-- Tables without RLS (expected: zero for exposed public application tables).
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname='public' AND NOT rowsecurity ORDER BY tablename;

-- Foreign keys with no valid index whose leading columns cover the FK columns.
-- Review candidates, not automatic failures: small tables may not need indexes.
WITH fk AS (
  SELECT c.oid, c.conname, c.conrelid, c.conkey, c.conrelid::regclass AS table_name,
         pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
  WHERE n.nspname='public' AND c.contype='f'
)
SELECT fk.table_name, fk.conname, fk.definition
FROM fk
WHERE NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indrelid=fk.conrelid AND i.indisvalid AND i.indpred IS NULL
    AND i.indnkeyatts >= cardinality(fk.conkey)
    AND ARRAY(SELECT i.indkey[k]::smallint FROM generate_series(0,cardinality(fk.conkey)-1) k ORDER BY k) = fk.conkey
)
ORDER BY fk.table_name::text, fk.conname;

-- Invalid indexes and unvalidated constraints.
SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
       pg_get_indexdef(i.oid) AS definition
FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid
JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND NOT ix.indisvalid ORDER BY t.relname, i.relname;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace='public'::regnamespace AND NOT convalidated
ORDER BY conrelid::regclass::text, conname;

-- Financial invariants.
SELECT (SELECT COALESCE(SUM(balance),0) FROM public.wallets) AS wallet_balance_sum,
       (SELECT max_supply FROM public.token_supply WHERE id=1) AS max_supply,
       (SELECT total_minted FROM public.token_supply WHERE id=1) AS total_minted;

SELECT g.code, w.id AS pool_wallet_id, w.balance, w.reserved_balance,
       COALESCE(b.pending_bets,0) AS pending_bets, COALESCE(b.liability,0) AS calculated_liability,
       w.reserved_balance-COALESCE(b.liability,0) AS reservation_delta
FROM public.games g JOIN public.wallets w ON w.id=g.pool_wallet_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE gb.status='PENDING') AS pending_bets,
         COALESCE(SUM(CEIL(gb.bet_amount::numeric*COALESCE(gb.auto_cashout,50)))
           FILTER (WHERE gb.status='PENDING'),0)::bigint AS liability
  FROM public.game_bets gb JOIN public.game_rounds gr ON gr.id=gb.round_id
  WHERE gr.game_code=g.code
) b ON TRUE ORDER BY g.code;

-- Incomplete rounds / lifecycle review.
SELECT gr.game_code, gr.id, gr.round_number, gr.status, gr.started_at,
       COUNT(gb.id) AS bets, COUNT(gb.id) FILTER (WHERE gb.status='PENDING') AS pending_bets
FROM public.game_rounds gr LEFT JOIN public.game_bets gb ON gb.round_id=gr.id
WHERE gr.status IN ('WAITING','RUNNING','CRASHED')
GROUP BY gr.game_code, gr.id, gr.round_number, gr.status, gr.started_at
ORDER BY gr.game_code, gr.round_number DESC;
