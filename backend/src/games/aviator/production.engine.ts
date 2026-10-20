import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getDatabaseClient } from '../../db/postgres';

let interval: NodeJS.Timeout | null = null;
let busy = false;
let busySince = 0;
let lastErrorAt = 0;
let lastStallWarningAt = 0;

function fairCrashMultiplier(seed: string, roundNumber: number): number {
  const digest = createHmac('sha256', seed).update(String(roundNumber)).digest('hex');
  const value = parseInt(digest.slice(0, 13), 16) / 0x10000000000000;
  const multiplier = Math.floor((0.97 / Math.max(1e-12, 1 - value)) * 100) / 100;
  return Math.min(50, Math.max(1, multiplier));
}

async function tick() {
  if (busy) {
    if (busySince && Date.now() - busySince > 30000 && Date.now() - lastStallWarningAt > 30000) {
      console.error('Persistent Crash engine tick appears stalled; a prior tick has not completed.', {
        stalledForMs: Date.now() - busySince,
      });
      lastStallWarningAt = Date.now();
    }
    return;
  }

  busy = true;
  busySince = Date.now();
  let phase = 'acquire database client';
  try {
    const client = getDatabaseClient();

    // Commit the CRASHED state before attempting settlement. If settlement fails,
    // the next tick can see CRASHED and retry instead of rolling the round back
    // to RUNNING forever. Settlement itself is atomic and idempotent in Postgres.
    phase = 'begin round-state transaction';
    const roundToSettle = await client.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '2s'");
      await tx.unsafe("SET LOCAL statement_timeout = '15s'");

      phase = 'acquire advisory lock';
      const lockRows = await tx.unsafe(
        "SELECT pg_try_advisory_xact_lock(hashtextextended('bigdaddy:aviator:round-engine', 0)) AS locked"
      );
      if (!lockRows[0]?.locked) return null;

      phase = 'find crashed round for recovery';
      const crashedRows = await tx.unsafe(
        "SELECT id FROM public.game_rounds WHERE game_code='aviator' AND status='CRASHED' ORDER BY round_number DESC LIMIT 1"
      );
      if (crashedRows[0]?.id) {
        console.info('Aviator engine retrying crashed-round settlement.', { roundId: crashedRows[0].id });
        return crashedRows[0].id;
      }

      phase = 'check game activation';
      const games = await tx.unsafe(
        "SELECT id,pool_wallet_id FROM public.games WHERE code='aviator' AND status='ACTIVE' LIMIT 1"
      );
      if (!games[0]) return null;

      phase = 'read latest round';
      const rows = await tx.unsafe(
        "SELECT id,round_number,status,started_at,ended_at,server_seed,crash_multiplier," +
        "EXTRACT(EPOCH FROM (now()-started_at)) AS elapsed_seconds," +
        "EXTRACT(EPOCH FROM (now()-ended_at)) AS seconds_since_end " +
        "FROM public.game_rounds WHERE game_code='aviator' ORDER BY round_number DESC LIMIT 1"
      );

      // Keep a full 20-second inter-round cooldown measured from the crash
      // timestamp (ended_at). Settlement still runs immediately in its own
      // transaction; the next round is not created until settlement is complete
      // and this cooldown has elapsed.
      if (
        rows[0]?.status === 'SETTLED' &&
        rows[0].ended_at &&
        Number(rows[0].seconds_since_end) >= 0 &&
        Number(rows[0].seconds_since_end) < 20
      ) {
        return null;
      }

      if (!rows[0] || rows[0].status === 'SETTLED') {
        phase = 'create next WAITING round';
        const maxRows = await tx.unsafe(
          "SELECT COALESCE(MAX(round_number),0)::bigint AS n FROM public.game_rounds WHERE game_code='aviator'"
        );
        const roundNumber = Number(maxRows[0].n) + 1;
        const seed = randomBytes(32).toString('hex');
        const commitment = createHash('sha256').update(seed).digest('hex');
        const crash = fairCrashMultiplier(seed, roundNumber);
        await tx.unsafe(
          "INSERT INTO public.game_rounds(game_code,round_number,status,server_seed,server_seed_hash,crash_multiplier,started_at) " +
          "VALUES('aviator',$1,'WAITING',$2,$3,$4,now())",
          [roundNumber, seed, commitment, crash]
        );
        console.info('Aviator engine created the next round.', { roundNumber, status: 'WAITING' });
        return null;
      }

      const round = rows[0] as unknown as {
        id: string;
        round_number: number;
        status: string;
        started_at: string;
        ended_at: string | null;
        server_seed: string;
        crash_multiplier: string | number;
        elapsed_seconds: string | number;
      };

      // Use PostgreSQL's clock for round progression, never the host clock.
      const ageSeconds = Math.max(0, Number(round.elapsed_seconds) || 0);
      if (round.status === 'WAITING') {
        if (ageSeconds >= 5) {
          phase = 'open betting round';
          const opened = await tx.unsafe(
            "UPDATE public.game_rounds SET status='RUNNING',started_at=now() WHERE id=$1 AND status='WAITING' RETURNING round_number",
            [round.id]
          );
          if (opened[0]) console.info('Aviator round entered RUNNING.', { roundNumber: opened[0].round_number });
        }
        return null;
      }

      if (round.status === 'RUNNING') {
        const multiplier = Math.floor(Math.exp(0.06 * Math.pow(ageSeconds, 1.15)) * 100) / 100;
        const crash = Number(round.crash_multiplier);
        if (multiplier >= crash) {
          phase = 'persist crash result';
          const crashed = await tx.unsafe(
            "UPDATE public.game_rounds SET status='CRASHED',ended_at=now(),revealed_server_seed=server_seed " +
            "WHERE id=$1 AND status='RUNNING' RETURNING id,round_number",
            [round.id]
          );
          if (crashed[0]) {
            console.info('Aviator round crashed; settlement will run separately.', {
              roundNumber: crashed[0].round_number,
              crashMultiplier: crash,
            });
            return crashed[0].id;
          }
          return null;
        }

        phase = 'process automatic cashouts';
        const autoBets = await tx.unsafe(
          "SELECT id,user_id FROM public.game_bets WHERE round_id=$1 AND status='PENDING' " +
          "AND auto_cashout IS NOT NULL AND auto_cashout <= $2",
          [round.id, multiplier]
        );
        for (const bet of autoBets) {
          try {
            await tx.unsafe(
              'SELECT public.cashout_crash_bet_atomic($1::uuid,$2::uuid,$3)',
              [bet.user_id, bet.id, 'AUTO_CASHOUT_' + bet.id]
            );
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
      phase = 'settle crashed round';
      await client.begin(async (tx) => {
        await tx.unsafe("SET LOCAL lock_timeout = '2s'");
        await tx.unsafe("SET LOCAL statement_timeout = '15s'");
        await tx.unsafe('SELECT public.settle_crash_round_atomic($1::uuid)', [roundToSettle]);
      });
      console.info('Aviator crashed round settlement completed.', { roundId: roundToSettle });
    }
  } catch (error) {
    if (Date.now() - lastErrorAt > 15000) {
      console.error('Persistent Crash engine tick failed.', {
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
      lastErrorAt = Date.now();
    }
  } finally {
    busy = false;
    busySince = 0;
  }
}

export function startProductionCrashEngine() {
  if (interval) return;
  interval = setInterval(() => { void tick(); }, 1000);
  void tick();
  console.log('Persistent Crash engine supervisor started; it activates only after the game is explicitly enabled.');
}

export function stopProductionCrashEngine() {
  if (interval) clearInterval(interval);
  interval = null;
}
