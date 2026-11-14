-- Publish only safe Aviator round-state fields through a public Realtime Broadcast topic.
-- Never broadcast server_seed, client_seed, or any user/bet data.
create or replace function aviator.broadcast_public_round_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'roundNumber', new.round_number,
      'status', new.status::text,
      'startedAt', new.started_at,
      'crashMultiplier', new.crash_multiplier,
      'endedAt', new.ended_at,
      'serverSeedHash', new.server_seed_hash,
      'revealedServerSeed', case when new.revealed_server_seed is not null then new.revealed_server_seed else null end
    ),
    'round_state_changed',
    'aviator:rounds',
    false
  );
  return new;
end;
$$;

drop trigger if exists aviator_round_state_broadcast on aviator.game_rounds;
create trigger aviator_round_state_broadcast
after insert or update of status, started_at, crash_multiplier, ended_at, server_seed_hash, revealed_server_seed
on aviator.game_rounds
for each row
execute function aviator.broadcast_public_round_state();
