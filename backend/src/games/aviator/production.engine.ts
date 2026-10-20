import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getDatabaseClient } from '../../db/postgres';

let interval: NodeJS.Timeout | null = null;
let busy = false;
let lastErrorAt = 0;

function fairCrashMultiplier(seed: string, roundNumber: number): number {
  const digest = createHmac('sha256', seed).update(String(roundNumber)).digest('hex');
  const value = parseInt(digest.slice(0, 13), 16) / 0x10000000000000;
  const multiplier = Math.floor((0.97 / Math.max(1e-12, 1 - value)) * 100) / 100;
  return Math.min(50, Math.max(1, multiplier));
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const client = getDatabaseClient();

    // Commit the CRASHED state before attempting settlement. If settlement fails,
    // the next tick can see CRASHED and retry instead of rolling the round back
    // to RUNNING forever. Settlement itself is atomic and idempotent in Postgres.
    const roundToSettle = await client.begin(async (tx) => {
      const sql = tx;
      await sql.unsafe("SET LOCAL lock_timeout = '2s'");
      await sql.unsafe("SET LOCAL statement_timeout = '15s'");
      const lockRows = await sql.unsafe(
        "SELECT pg_try_advisory_xact_lock(hashtext('bigdaddy:aviator:round-engine')) AS locked"
      );
      if (!lockRows[0]?.locked) return null;

      const games = await sql.unsafe("SELECT id,pool_wallet_id FROM public.games WHERE code='aviator' AND status='ACTIVE' LIMIT 1");
      if (!games[0]) return null;

      const rows = await sql.unsafe("SELECT id,round_number,status,started_at,ended_at,server_seed,crash_multiplier,EXTRACT(EPOCH FROM (now()-started_at)) AS elapsed_seconds,EXTRACT(EPOCH FROM (now()-ended_at)) AS seconds_since_end FROM public.game_rounds WHERE game_code='aviator' ORDER BY round_number DESC LIMIT 1");
      if (rows[0]?.status === 'SETTLED' && rows[0].ended_at && Number(rows[0].seconds_since_end) >= 0 && Number(rows[0].seconds_since_end) < 4) return null;
      if (!rows[0] || rows[0].status === 'SETTLED') {
        const maxRows = await sql.unsafe("SELECT COALESCE(MAX(round_number),0)::bigint AS n FROM public.game_rounds WHERE game_code='aviator'");
        const roundNumber = Number(maxRows[0].n) + 1;
        const seed = randomBytes(32).toString('hex');
        const commitment = createHash('sha256').update(seed).digest('hex');
        const crash = fairCrashMultiplier(seed, roundNumber);
        await sql.unsafe("INSERT INTO public.game_rounds(game_code,round_number,status,server_seed,server_seed_hash,crash_multiplier,started_at) VALUES('aviator',$1,'WAITING',$2,$3,$4,now())", [roundNumber, seed, commitment, crash]);
        return null;
      }

      const round = rows[0] as unknown as { id: string; round_number: number; status: string; started_at: string; ended_at: string | null; server_seed: string; crash_multiplier: string | number; elapsed_seconds: string | number };

      // Recovery path: CRASHED is durable now, so a failed settlement can be
      // retried by a later tick without replaying the crash transition.
      if (round.status === 'CRASHED') return round.id;

      // Use PostgreSQL's clock for round progression, never the host clock.
      const ageSeconds = Math.max(0, Number(round.elapsed_seconds) || 0);
      if (round.status === 'WAITING') {
        if (ageSeconds >= 5) {
          await sql.unsafe("UPDATE public.game_rounds SET status='RUNNING',started_at=now() WHERE id=$1 AND status='WAITING'", [round.id]);
        }
        return null;
      }

      if (round.status === 'RUNNING') {
        const multiplier = Math.floor(Math.exp(0.06 * Math.pow(ageSeconds, 1.15)) * 100) / 100;
        const crash = Number(round.crash_multiplier);
        if (multiplier >= crash) {
          const crashed = await sql.unsafe(
            "UPDATE public.game_rounds SET status='CRASHED',ended_at=now(),revealed_server_seed=server_seed WHERE id=$1 AND status='RUNNING' RETURNING id",
            [round.id]
          );
          return crashed[0]?.id ?? null;
        }

        const autoBets = await sql.unsafe("SELECT id,user_id FROM public.game_bets WHERE round_id=$1 AND status='PENDING' AND auto_cashout IS NOT NULL AND auto_cashout <= $2", [round.id, multiplier]);
        for (const bet of autoBets) {
          try {
            await sql.unsafe('SELECT public.cashout_crash_bet_atomic($1::uuid,$2::uuid,$3)', [bet.user_id, bet.id, 'AUTO_CASHOUT_' + bet.id]);
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (!message.includes('ROUND_ALREADY_CRASHED') && !message.includes('BET_ALREADY_SETTLED')) throw error;
          }
        }
      }
      return null;
    });

    // Separate transaction is intentional: the CRASHED marker must survive a
    // settlement error. The DB function locks the round and uses idempotent
    // wallet transaction keys, so concurrent retries cannot double-pay.
    if (roundToSettle) {
      await client.begin(async (tx) => {
        await tx.unsafe('SET LOCAL lock_timeout = \'2s\'');
        await tx.unsafe('SET LOCAL statement_timeout = \'15s\'');
        await tx.unsafe('SELECT public.settle_crash_round_atomic($1::uuid)', [roundToSettle]);
      });
    }
  } catch (error) {
    if (Date.now() - lastErrorAt > 15000) {
      console.error('Persistent Crash engine tick failed:', error);
      lastErrorAt = Date.now();
    }
  } finally {
    busy = false;
  }
}

export function startProductionCrashEngine() {
  if (interval) return;
  interval = setInterval(() => { void tick(); }, 250);
  void tick();
  console.log('Persistent Crash engine supervisor started; it activates only after the game is explicitly enabled.');
}

export function stopProductionCrashEngine() {
  if (interval) clearInterval(interval);
  interval = null;
}
