-- Fix SHA-256 result calculation by using bigint arithmetic to prevent PostgreSQL integer overflow.
-- Correctly settle Roulette stakes from escrow: refund stake on wins, transfer losses to pool,
-- and pay only net winnings from the pool. All wallet movements remain one DB transaction.
CREATE OR REPLACE FUNCTION roulette.advance_round()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 g record; r roulette.authoritative_game_rounds%ROWTYPE; b roulette.authoritative_game_bets%ROWTYPE;
 seed text; h text; d bytea; n integer; c text; t text; nums jsonb; mult bigint; won boolean; gross bigint; profit bigint;
 tx uuid; stake_tx uuid; pw uuid; ew uuid; uw uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('roulette-round-lifecycle-v1'));
 SELECT id,status,pool_wallet_id INTO g FROM platform.games WHERE code='roulette' FOR UPDATE;
 IF NOT FOUND OR g.status<>'ACTIVE' OR g.pool_wallet_id IS NULL THEN
  RETURN jsonb_build_object('status','COMING_SOON','gameStateUnavailable',true);
 END IF;
 pw:=g.pool_wallet_id;
 SELECT id INTO ew FROM wallet.wallets WHERE wallet_type='ESCROW' ORDER BY id LIMIT 1 FOR UPDATE;
 IF ew IS NULL THEN RAISE EXCEPTION 'ROULETTE_ESCROW_WALLET_MISSING'; END IF;
 SELECT * INTO r FROM roulette.authoritative_game_rounds WHERE game_code='roulette' ORDER BY round_number DESC LIMIT 1 FOR UPDATE;
 IF FOUND AND r.status='BETTING' AND r.betting_closes_at<=now() THEN
  seed:=r.server_seed;
  IF seed IS NULL THEN RAISE EXCEPTION 'ROULETTE_SEED_MISSING'; END IF;
  h:=encode(extensions.digest(seed,'sha256'),'hex');
  IF h<>r.server_seed_hash THEN RAISE EXCEPTION 'ROULETTE_SEED_HASH_MISMATCH'; END IF;
  d:=extensions.digest(seed||':'||r.id::text,'sha256');
  n:=mod(get_byte(d,0)::bigint*16777216::bigint+get_byte(d,1)::bigint*65536::bigint+get_byte(d,2)::bigint*256::bigint+get_byte(d,3)::bigint,37)::integer;
  c:=CASE WHEN n=0 THEN 'green' WHEN n IN (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36) THEN 'red' ELSE 'black' END;
  UPDATE roulette.authoritative_game_rounds SET status='RUNNING',result=jsonb_build_object('number',n,'color',c),state=state||jsonb_build_object('spinStartedAt',now()) WHERE id=r.id;
  SELECT * INTO r FROM roulette.authoritative_game_rounds WHERE id=r.id;
 END IF;

 -- Settle only after the persisted spin animation interval has elapsed.
 IF FOUND AND r.status='RUNNING' AND (r.state->>'spinStartedAt')::timestamptz<=now()-interval '1500 milliseconds' THEN
  seed:=r.server_seed;
  IF seed IS NULL OR encode(extensions.digest(seed,'sha256'),'hex')<>r.server_seed_hash THEN RAISE EXCEPTION 'ROULETTE_SEED_HASH_MISMATCH'; END IF;
  n:=(r.result->>'number')::integer; c:=r.result->>'color';
  FOR b IN SELECT * FROM roulette.authoritative_game_bets WHERE round_id=r.id AND status='PENDING' ORDER BY id FOR UPDATE LOOP
   t:=lower(coalesce(b.selection->>'type','')); nums:=coalesce(b.selection->'numbers','[]'::jsonb);
   mult:=CASE WHEN t IN ('straight','number') THEN 36 WHEN t='split' THEN 18 WHEN t='street' THEN 12 WHEN t='corner' THEN 9 WHEN t='line' THEN 6 WHEN t LIKE 'dozen%' OR t LIKE 'col%' THEN 3 ELSE 2 END;
   won:=CASE WHEN n=0 THEN t IN ('straight','number') AND nums @> '[0]'::jsonb
    WHEN t IN ('straight','number','split','street','corner','line') THEN nums @> to_jsonb(ARRAY[n])
    WHEN t='red' THEN c='red' WHEN t='black' THEN c='black'
    WHEN t='even' THEN n>0 AND n%2=0 WHEN t='odd' THEN n%2=1
    WHEN t='low' THEN n BETWEEN 1 AND 18 WHEN t='high' THEN n BETWEEN 19 AND 36
    WHEN t='dozen1' THEN n BETWEEN 1 AND 12 WHEN t='dozen2' THEN n BETWEEN 13 AND 24 WHEN t='dozen3' THEN n BETWEEN 25 AND 36
    WHEN t='col1' THEN n%3=1 WHEN t='col2' THEN n%3=2 WHEN t='col3' THEN n%3=0 ELSE false END;
   gross:=CASE WHEN won THEN b.bet_amount*mult ELSE 0 END; profit:=CASE WHEN won THEN gross-b.bet_amount ELSE 0 END; tx:=NULL; stake_tx:=NULL;
   SELECT id INTO uw FROM wallet.wallets WHERE user_id=b.user_id AND wallet_type='PLAYER' ORDER BY id LIMIT 1 FOR UPDATE;
   IF uw IS NULL THEN RAISE EXCEPTION 'ROULETTE_PLAYER_WALLET_MISSING'; END IF;
   IF won THEN
    SELECT wallet.wallet_transfer_atomic('ROULETTE_STAKE_RETURN_'||replace(b.id::text,'-',''),'BET_ESCROW_REFUND'::public.transaction_type_enum,b.bet_amount,ew,uw,
     jsonb_build_object('gameCode','roulette','roundId',r.id,'betId',b.id,'reason','winning stake return')) INTO stake_tx;
    IF profit>0 THEN
     SELECT wallet.wallet_transfer_atomic('ROULETTE_PAYOUT_'||replace(b.id::text,'-',''),'BET_WIN_PAYOUT'::public.transaction_type_enum,profit,pw,uw,
      jsonb_build_object('gameCode','roulette','roundId',r.id,'betId',b.id,'winningNumber',n,'grossPayout',gross::text)) INTO tx;
    END IF;
   ELSE
    SELECT wallet.wallet_transfer_atomic('ROULETTE_LOSS_'||replace(b.id::text,'-',''),'BET_LOSS_TREASURY'::public.transaction_type_enum,b.bet_amount,ew,pw,
     jsonb_build_object('gameCode','roulette','roundId',r.id,'betId',b.id,'winningNumber',n)) INTO stake_tx;
   END IF;
   UPDATE roulette.authoritative_game_bets SET status=CASE WHEN won THEN 'WON' ELSE 'LOST' END,payout_amount=gross,
    payout_transaction_id=tx,stake_release_transaction_id=stake_tx,settled_at=now() WHERE id=b.id;
   UPDATE wallet.wallets SET reserved_balance=reserved_balance-b.reserved_liability,updated_at=now() WHERE id=pw AND reserved_balance>=b.reserved_liability;
   IF NOT FOUND THEN RAISE EXCEPTION 'ROULETTE_RESERVED_LIABILITY_MISMATCH'; END IF;
  END LOOP;
  UPDATE roulette.authoritative_game_rounds SET status='SETTLED',settled_at=now(),server_seed=seed,result=jsonb_build_object('number',n,'color',c),state=state||jsonb_build_object('settlementComplete',true) WHERE id=r.id;
  SELECT * INTO r FROM roulette.authoritative_game_rounds WHERE id=r.id;
 END IF;
 IF NOT FOUND OR (r.status IN ('SETTLED','CANCELLED') AND (r.settled_at IS NULL OR r.settled_at<now()-interval '3 seconds')) THEN
  seed:=encode(extensions.gen_random_bytes(32),'hex'); h:=encode(extensions.digest(seed,'sha256'),'hex');
  INSERT INTO roulette.authoritative_game_rounds(game_code,round_number,status,state,server_seed_hash,server_seed,opened_at,betting_closes_at)
   SELECT 'roulette',coalesce(max(round_number),0)+1,'BETTING',jsonb_build_object('totalBetsCount',0,'totalBetAmount','0'),h,seed,now(),now()+interval '15 seconds'
   FROM roulette.authoritative_game_rounds RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('gameCode','roulette','status','ACTIVE',
  'round',jsonb_build_object('id',r.id,'roundNumber',r.round_number,'status',r.status,'openedAt',r.opened_at,'bettingEndsAt',r.betting_closes_at,
   'result',CASE WHEN r.status IN ('RUNNING','RESULT','SETTLED') THEN r.result ELSE NULL END,'serverSeedHash',r.server_seed_hash,
   'revealedServerSeed',CASE WHEN r.status='SETTLED' THEN r.server_seed ELSE NULL END),
  'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('roundNumber',x.round_number,'result',x.result,'timestamp',x.settled_at) ORDER BY x.round_number DESC),'[]'::jsonb)
   FROM (SELECT round_number,result,settled_at FROM roulette.authoritative_game_rounds WHERE status='SETTLED' ORDER BY round_number DESC LIMIT 25) x));
END; $$;
REVOKE ALL ON FUNCTION roulette.advance_round() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION roulette.advance_round() TO service_role;
