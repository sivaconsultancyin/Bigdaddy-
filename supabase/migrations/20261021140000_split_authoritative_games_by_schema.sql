-- Split authoritative game runtime data into per-game schemas.
-- The shared tables are copied transactionally, then replaced with read-only
-- compatibility views. Application writes must use the whitelisted schema route.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.authoritative_game_bets WHERE status::text = 'PENDING') THEN
    RAISE EXCEPTION 'Per-game schema split blocked: pending bets exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.authoritative_game_rounds WHERE status::text IN ('BETTING','RUNNING','RESULT')) THEN
    RAISE EXCEPTION 'Per-game schema split blocked: active rounds exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.authoritative_game_rounds
    WHERE game_code NOT IN ('roulette','dice','dragon_tiger','andar_bahar')
  ) THEN
    RAISE EXCEPTION 'Per-game schema split blocked: unsupported game code exists';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS roulette;
CREATE SCHEMA IF NOT EXISTS dice;
CREATE SCHEMA IF NOT EXISTS dragon_tiger;
CREATE SCHEMA IF NOT EXISTS andar_bahar;
REVOKE ALL ON SCHEMA roulette, dice, dragon_tiger, andar_bahar FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA roulette, dice, dragon_tiger, andar_bahar TO service_role;

-- Fail safely if a partial/manual attempt already created destination tables.
DO $destinations$
DECLARE
  schema_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['roulette','dice','dragon_tiger','andar_bahar'] LOOP
    IF to_regclass(format('%I.authoritative_game_rounds', schema_name)) IS NOT NULL
       OR to_regclass(format('%I.authoritative_game_bets', schema_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'Per-game schema split blocked: destination tables already exist in %', schema_name;
    END IF;
  END LOOP;
END
$destinations$;

CREATE TABLE roulette.authoritative_game_rounds (LIKE public.authoritative_game_rounds INCLUDING ALL);
CREATE TABLE dice.authoritative_game_rounds (LIKE public.authoritative_game_rounds INCLUDING ALL);
CREATE TABLE dragon_tiger.authoritative_game_rounds (LIKE public.authoritative_game_rounds INCLUDING ALL);
CREATE TABLE andar_bahar.authoritative_game_rounds (LIKE public.authoritative_game_rounds INCLUDING ALL);

CREATE TABLE roulette.authoritative_game_bets (LIKE public.authoritative_game_bets INCLUDING ALL);
CREATE TABLE dice.authoritative_game_bets (LIKE public.authoritative_game_bets INCLUDING ALL);
CREATE TABLE dragon_tiger.authoritative_game_bets (LIKE public.authoritative_game_bets INCLUDING ALL);
CREATE TABLE andar_bahar.authoritative_game_bets (LIKE public.authoritative_game_bets INCLUDING ALL);

ALTER TABLE roulette.authoritative_game_rounds ADD CONSTRAINT roulette_round_game_code CHECK (game_code = 'roulette');
ALTER TABLE dice.authoritative_game_rounds ADD CONSTRAINT dice_round_game_code CHECK (game_code = 'dice');
ALTER TABLE dragon_tiger.authoritative_game_rounds ADD CONSTRAINT dragon_tiger_round_game_code CHECK (game_code = 'dragon_tiger');
ALTER TABLE andar_bahar.authoritative_game_rounds ADD CONSTRAINT andar_bahar_round_game_code CHECK (game_code = 'andar_bahar');

ALTER TABLE roulette.authoritative_game_bets
  ADD CONSTRAINT roulette_bet_round_fk FOREIGN KEY (round_id) REFERENCES roulette.authoritative_game_rounds(id) ON DELETE RESTRICT,
  ADD CONSTRAINT roulette_bet_user_fk FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT roulette_bet_escrow_tx_fk FOREIGN KEY (escrow_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT roulette_bet_stake_tx_fk FOREIGN KEY (stake_release_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT roulette_bet_payout_tx_fk FOREIGN KEY (payout_transaction_id) REFERENCES wallet.wallet_transactions(id);
ALTER TABLE dice.authoritative_game_bets
  ADD CONSTRAINT dice_bet_round_fk FOREIGN KEY (round_id) REFERENCES dice.authoritative_game_rounds(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dice_bet_user_fk FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dice_bet_escrow_tx_fk FOREIGN KEY (escrow_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT dice_bet_stake_tx_fk FOREIGN KEY (stake_release_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT dice_bet_payout_tx_fk FOREIGN KEY (payout_transaction_id) REFERENCES wallet.wallet_transactions(id);
ALTER TABLE dragon_tiger.authoritative_game_bets
  ADD CONSTRAINT dragon_tiger_bet_round_fk FOREIGN KEY (round_id) REFERENCES dragon_tiger.authoritative_game_rounds(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dragon_tiger_bet_user_fk FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dragon_tiger_bet_escrow_tx_fk FOREIGN KEY (escrow_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT dragon_tiger_bet_stake_tx_fk FOREIGN KEY (stake_release_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT dragon_tiger_bet_payout_tx_fk FOREIGN KEY (payout_transaction_id) REFERENCES wallet.wallet_transactions(id);
ALTER TABLE andar_bahar.authoritative_game_bets
  ADD CONSTRAINT andar_bahar_bet_round_fk FOREIGN KEY (round_id) REFERENCES andar_bahar.authoritative_game_rounds(id) ON DELETE RESTRICT,
  ADD CONSTRAINT andar_bahar_bet_user_fk FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT andar_bahar_bet_escrow_tx_fk FOREIGN KEY (escrow_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT andar_bahar_bet_stake_tx_fk FOREIGN KEY (stake_release_transaction_id) REFERENCES wallet.wallet_transactions(id),
  ADD CONSTRAINT andar_bahar_bet_payout_tx_fk FOREIGN KEY (payout_transaction_id) REFERENCES wallet.wallet_transactions(id);

-- Copy settled/cancelled historical rows with original IDs, seeds, bets and ledger references.
INSERT INTO roulette.authoritative_game_rounds SELECT * FROM public.authoritative_game_rounds WHERE game_code='roulette';
INSERT INTO dice.authoritative_game_rounds SELECT * FROM public.authoritative_game_rounds WHERE game_code='dice';
INSERT INTO dragon_tiger.authoritative_game_rounds SELECT * FROM public.authoritative_game_rounds WHERE game_code='dragon_tiger';
INSERT INTO andar_bahar.authoritative_game_rounds SELECT * FROM public.authoritative_game_rounds WHERE game_code='andar_bahar';

INSERT INTO roulette.authoritative_game_bets
SELECT b.* FROM public.authoritative_game_bets b JOIN public.authoritative_game_rounds r ON r.id=b.round_id WHERE r.game_code='roulette';
INSERT INTO dice.authoritative_game_bets
SELECT b.* FROM public.authoritative_game_bets b JOIN public.authoritative_game_rounds r ON r.id=b.round_id WHERE r.game_code='dice';
INSERT INTO dragon_tiger.authoritative_game_bets
SELECT b.* FROM public.authoritative_game_bets b JOIN public.authoritative_game_rounds r ON r.id=b.round_id WHERE r.game_code='dragon_tiger';
INSERT INTO andar_bahar.authoritative_game_bets
SELECT b.* FROM public.authoritative_game_bets b JOIN public.authoritative_game_rounds r ON r.id=b.round_id WHERE r.game_code='andar_bahar';

-- Preserve row counts and IDs before removing the shared source tables.
DO $verify_copy$
BEGIN
  IF (SELECT count(*) FROM public.authoritative_game_rounds) <>
       (SELECT count(*) FROM roulette.authoritative_game_rounds) +
       (SELECT count(*) FROM dice.authoritative_game_rounds) +
       (SELECT count(*) FROM dragon_tiger.authoritative_game_rounds) +
       (SELECT count(*) FROM andar_bahar.authoritative_game_rounds) THEN
    RAISE EXCEPTION 'Per-game schema split failed round count reconciliation';
  END IF;
  IF (SELECT count(*) FROM public.authoritative_game_bets) <>
       (SELECT count(*) FROM roulette.authoritative_game_bets) +
       (SELECT count(*) FROM dice.authoritative_game_bets) +
       (SELECT count(*) FROM dragon_tiger.authoritative_game_bets) +
       (SELECT count(*) FROM andar_bahar.authoritative_game_bets) THEN
    RAISE EXCEPTION 'Per-game schema split failed bet count reconciliation';
  END IF;
END
$verify_copy$;

ALTER TABLE roulette.authoritative_game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dice.authoritative_game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dragon_tiger.authoritative_game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE andar_bahar.authoritative_game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE roulette.authoritative_game_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dice.authoritative_game_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dragon_tiger.authoritative_game_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE andar_bahar.authoritative_game_bets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON roulette.authoritative_game_rounds, roulette.authoritative_game_bets,
  dice.authoritative_game_rounds, dice.authoritative_game_bets,
  dragon_tiger.authoritative_game_rounds, dragon_tiger.authoritative_game_bets,
  andar_bahar.authoritative_game_rounds, andar_bahar.authoritative_game_bets
FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON roulette.authoritative_game_rounds, roulette.authoritative_game_bets,
  dice.authoritative_game_rounds, dice.authoritative_game_bets,
  dragon_tiger.authoritative_game_rounds, dragon_tiger.authoritative_game_bets,
  andar_bahar.authoritative_game_rounds, andar_bahar.authoritative_game_bets TO service_role;

DROP TABLE public.authoritative_game_bets;
DROP TABLE public.authoritative_game_rounds;

-- Compatibility views are intentionally read-only (UNION ALL). All runtime writes
-- must use the game-specific tables selected from the fixed GameCode whitelist.
CREATE VIEW public.authoritative_game_rounds AS
  SELECT * FROM roulette.authoritative_game_rounds
  UNION ALL SELECT * FROM dice.authoritative_game_rounds
  UNION ALL SELECT * FROM dragon_tiger.authoritative_game_rounds
  UNION ALL SELECT * FROM andar_bahar.authoritative_game_rounds;
CREATE VIEW public.authoritative_game_bets AS
  SELECT * FROM roulette.authoritative_game_bets
  UNION ALL SELECT * FROM dice.authoritative_game_bets
  UNION ALL SELECT * FROM dragon_tiger.authoritative_game_bets
  UNION ALL SELECT * FROM andar_bahar.authoritative_game_bets;

REVOKE ALL ON public.authoritative_game_rounds, public.authoritative_game_bets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.authoritative_game_rounds, public.authoritative_game_bets TO service_role;

COMMIT;
