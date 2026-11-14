-- Validate Roulette bet types and number-array shape inside PostgreSQL.
CREATE OR REPLACE FUNCTION roulette.validate_bet_selection()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE t text; expected_count integer; item text; n integer; seen integer:=0;
BEGIN
 IF jsonb_typeof(NEW.selection)<>'object' THEN RAISE EXCEPTION 'INVALID_ROULETTE_SELECTION'; END IF;
 t:=lower(coalesce(NEW.selection->>'type',''));
 expected_count:=CASE t WHEN 'straight' THEN 1 WHEN 'number' THEN 1 WHEN 'split' THEN 2 WHEN 'street' THEN 3 WHEN 'corner' THEN 4 WHEN 'line' THEN 6
  WHEN 'red' THEN 0 WHEN 'black' THEN 0 WHEN 'even' THEN 0 WHEN 'odd' THEN 0 WHEN 'low' THEN 0 WHEN 'high' THEN 0
  WHEN 'dozen1' THEN 0 WHEN 'dozen2' THEN 0 WHEN 'dozen3' THEN 0 WHEN 'col1' THEN 0 WHEN 'col2' THEN 0 WHEN 'col3' THEN 0 ELSE -1 END;
 IF expected_count<0 THEN RAISE EXCEPTION 'INVALID_ROULETTE_BET_TYPE'; END IF;
 IF NEW.selection ? 'numbers' AND jsonb_typeof(NEW.selection->'numbers')<>'array' THEN RAISE EXCEPTION 'INVALID_ROULETTE_NUMBERS'; END IF;
 IF coalesce(jsonb_array_length(NEW.selection->'numbers'),0)<>expected_count THEN RAISE EXCEPTION 'INVALID_ROULETTE_NUMBER_COUNT'; END IF;
 FOR item IN SELECT jsonb_array_elements_text(coalesce(NEW.selection->'numbers','[]'::jsonb)) LOOP
  IF item !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'INVALID_ROULETTE_NUMBER'; END IF;
  n:=item::integer;
  IF n<0 OR n>36 THEN RAISE EXCEPTION 'INVALID_ROULETTE_NUMBER'; END IF;
  seen:=seen+1;
 END LOOP;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(coalesce(NEW.selection->'numbers','[]'::jsonb)) e(value))<>seen THEN
  RAISE EXCEPTION 'DUPLICATE_ROULETTE_NUMBER';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER roulette_validate_bet_selection
BEFORE INSERT OR UPDATE OF selection,bet_amount ON roulette.authoritative_game_bets
FOR EACH ROW EXECUTE FUNCTION roulette.validate_bet_selection();
REVOKE ALL ON FUNCTION roulette.validate_bet_selection() FROM PUBLIC,anon,authenticated;