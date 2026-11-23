import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { getEngineDatabaseClient } from '../../db/postgres';

type EngineTickResult = {
  action?: string;
  roundId?: string;
  roundNumber?: number;
  crashMultiplier?: number | string;
  betsSettled?: number;
  multiplier?: number;
  broadcastMultiplier?: number;
  broadcastTickSequence?: number;
};

const LEASE_TTL_SECONDS = 45;
const HEARTBEAT_INTERVAL_MS = 15_000;
const TICK_INTERVAL_MS = 1_000;
let workerRunning = false;
let workerPromise: Promise<void> | null = null;
let lastErrorAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function logWorkerError(message: string, error: unknown) {
  if (Date.now() - lastErrorAt < 15_000) return;
  console.error(message, error instanceof Error ? error.message : String(error));
  lastErrorAt = Date.now();
}

/** Matches the production SQL HMAC-SHA256 crash commitment algorithm exactly. */
export function deriveCrashMultiplier(seed: string, roundNumber: number): number {
  const digest = createHmac('sha256', seed).update(String(roundNumber)).digest('hex');
  const top52Bits = BigInt('0x' + digest.slice(0, 14)) >> 4n;
  const value = Number(top52Bits) / 4_503_599_627_370_496;
  const crash = Math.floor((0.97 / Math.max(0.000000000001, 1 - value)) * 100) / 100;
  return Math.min(50, Math.max(1, crash));
}

async function tickCrashEngine(): Promise<EngineTickResult> {
  const sql = getEngineDatabaseClient();
  return sql.begin(async (tx) => {
    const locks = await tx.unsafe(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('bigdaddy:aviator:round-engine', 0)) AS acquired",
    );
    if (!locks[0]?.acquired) return { action: 'busy' };

    const crashed = await tx.unsafe(
      "SELECT id FROM aviator.game_rounds WHERE game_code='aviator' AND status='CRASHED' ORDER BY round_number DESC LIMIT 1 FOR UPDATE",
    );
    if (crashed[0]) {
      const settled = await tx.unsafe(
        'SELECT aviator.settle_crash_round_atomic($1::uuid) AS count',
        [crashed[0].id],
      );
      return {
        action: 'settled_recovery',
        roundId: crashed[0].id,
        betsSettled: Number(settled[0]?.count ?? 0),
      };
    }

    const games = await tx.unsafe(
      "SELECT id,pool_wallet_id FROM platform.games WHERE code='aviator' AND status='ACTIVE' LIMIT 1",
    );
    if (!games[0]?.pool_wallet_id) return { action: 'game_inactive' };

    const rows = await tx.unsafe(
      `SELECT id,round_number,status,started_at,ended_at,server_seed,crash_multiplier,
        EXTRACT(EPOCH FROM (clock_timestamp()-started_at)) AS elapsed_seconds,
        EXTRACT(EPOCH FROM (clock_timestamp()-ended_at)) AS seconds_since_end
       FROM aviator.game_rounds WHERE game_code='aviator'
       ORDER BY round_number DESC LIMIT 1 FOR UPDATE`,
    );
    const round = rows[0];

    if (round?.status === 'SETTLED' && round.ended_at &&
        Number(round.seconds_since_end) >= 0 && Number(round.seconds_since_end) < 4) {
      return { action: 'cooldown', roundNumber: Number(round.round_number) };
    }

    if (!round || round.status === 'SETTLED') {
      const nextRows = await tx.unsafe(
        "SELECT COALESCE(MAX(round_number),0)::bigint+1 AS round_number FROM aviator.game_rounds WHERE game_code='aviator'",
      );
      const roundNumber = Number(nextRows[0].round_number);
      const seed = randomBytes(32).toString('hex');
      const commitment = createHash('sha256').update(seed).digest('hex');
      const crashMultiplier = deriveCrashMultiplier(seed, roundNumber);
      const inserted = await tx.unsafe(
        `INSERT INTO aviator.game_rounds
          (game_code,round_number,status,server_seed,server_seed_hash,crash_multiplier,started_at)
         VALUES ('aviator',$1,'WAITING',$2,$3,$4,clock_timestamp()) RETURNING id`,
        [roundNumber, seed, commitment, crashMultiplier],
      );
      return { action: 'round_created', roundId: inserted[0].id, roundNumber };
    }

    const ageSeconds = Math.max(0, Number(round.elapsed_seconds ?? 0));
    if (round.status === 'WAITING') {
      if (ageSeconds >= 5) {
        const updated = await tx.unsafe(
          "UPDATE aviator.game_rounds SET status='RUNNING',started_at=clock_timestamp() WHERE id=$1 AND status='WAITING' RETURNING id",
          [round.id],
        );
        if (updated[0]) {
          return { action: 'round_started', roundId: round.id, roundNumber: Number(round.round_number) };
        }
      }
      return { action: 'waiting', roundId: round.id, roundNumber: Number(round.round_number) };
    }

    if (round.status === 'RUNNING') {
      if (ageSeconds >= 60) {
        await tx.unsafe(
          "UPDATE aviator.game_rounds SET status='CRASHED',ended_at=clock_timestamp(),revealed_server_seed=server_seed WHERE id=$1 AND status='RUNNING'",
          [round.id],
        );
        return { action: 'round_crashed', roundId: round.id, roundNumber: Number(round.round_number), crashMultiplier: Number(round.crash_multiplier) };
      }

      const multiplier = Math.floor(Math.exp(0.06 * Math.pow(ageSeconds, 1.15)) * 100) / 100;
      if (multiplier >= Number(round.crash_multiplier)) {
        await tx.unsafe(
          "UPDATE aviator.game_rounds SET status='CRASHED',ended_at=clock_timestamp(),revealed_server_seed=server_seed WHERE id=$1 AND status='RUNNING'",
          [round.id],
        );
        return { action: 'round_crashed', roundId: round.id, roundNumber: Number(round.round_number), crashMultiplier: Number(round.crash_multiplier) };
      }

      const autoCashouts = await tx.unsafe(
        `SELECT id,user_id FROM aviator.game_bets
         WHERE round_id=$1 AND status='PENDING' AND auto_cashout IS NOT NULL AND auto_cashout <= $2
         ORDER BY id FOR UPDATE`,
        [round.id, multiplier],
      );
      for (const bet of autoCashouts) {
        try {
          await tx.unsafe(
            "SELECT aviator.cashout_crash_bet_atomic($1::uuid,$2::uuid,$3::text)",
            [bet.user_id, bet.id, 'AUTO_CASHOUT_' + String(bet.id).replace(/-/g, '')],
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('ROUND_ALREADY_CRASHED') && !message.includes('BET_ALREADY_SETTLED')) throw error;
        }
      }
      return { action: 'round_running', roundId: round.id, roundNumber: Number(round.round_number), multiplier };
    }

    return { action: 'no_op', roundId: round.id, roundNumber: Number(round.round_number) };
  });
}

async function broadcastMultiplier(result: EngineTickResult): Promise<EngineTickResult> {
  if (result.action !== 'round_running' || !result.roundId || !Number.isFinite(result.multiplier)) return result;
  const sql = getEngineDatabaseClient();
  const rows = await sql.begin(async (tx) => {
    const updated = await tx.unsafe(
      `UPDATE aviator.game_rounds AS r
       SET multiplier_tick_seq=r.multiplier_tick_seq+1,
           last_multiplier_broadcast_at=clock_timestamp()
       WHERE r.id=$1 AND r.status='RUNNING'
         AND (r.last_multiplier_broadcast_at IS NULL
              OR r.last_multiplier_broadcast_at <= clock_timestamp()-interval '1 second')
       RETURNING r.id,r.round_number,r.status::text,r.started_at,r.ended_at,
         r.server_seed_hash,r.revealed_server_seed,r.multiplier_tick_seq,
         clock_timestamp() AS server_time`,
      [result.roundId],
    );
    if (!updated[0]) return null;
    const row = updated[0];
    const payload = {
      id: row.id,
      roundNumber: Number(row.round_number),
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      serverSeedHash: row.server_seed_hash,
      revealedServerSeed: row.revealed_server_seed ?? null,
      multiplier: result.multiplier,
      tickSequence: Number(row.multiplier_tick_seq),
      serverTime: row.server_time,
    };
    await tx.unsafe(
      "SELECT realtime.send($1::jsonb,'round_state_changed','aviator:rounds',false)",
      [JSON.stringify(payload)],
    );
    return { multiplier: result.multiplier, sequence: Number(row.multiplier_tick_seq) };
  });
  if (!rows) return result;
  return { ...result, broadcastMultiplier: rows.multiplier, broadcastTickSequence: rows.sequence };
}

async function runWorker(): Promise<void> {
  const sql = getEngineDatabaseClient();
  const ownerToken = randomUUID();
  let ownsLease = false;
  let nextHeartbeatAt = 0;
  try {
    while (workerRunning) {
      if (!ownsLease) {
        const claim = await sql.unsafe(
          'SELECT aviator.claim_crash_engine_lease($1::uuid,$2::integer) AS claimed',
          [ownerToken, LEASE_TTL_SECONDS],
        );
        ownsLease = claim[0]?.claimed === true;
        if (!ownsLease) {
          await sleep(5_000);
          continue;
        }
        nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS;
        const snapshot = await sql.unsafe(
          "SELECT generation,lease_expires_at FROM aviator.engine_worker_lease WHERE lease_key='aviator'",
        );
        console.info(JSON.stringify({
          event: 'aviator_worker_acquired',
          workerId: ownerToken,
          generation: snapshot[0]?.generation ?? null,
          leaseExpiresAt: snapshot[0]?.lease_expires_at ?? null,
          runtime: 'node',
          at: new Date().toISOString(),
        }));
      }

      let result = await tickCrashEngine();
      result = await broadcastMultiplier(result);
      if (['round_created', 'round_started', 'round_crashed', 'settled_recovery'].includes(result.action ?? '')) {
        console.info(JSON.stringify({
          event: 'aviator_engine_state_transition',
          workerId: ownerToken,
          action: result.action,
          roundId: result.roundId ?? null,
          roundNumber: result.roundNumber ?? null,
          at: new Date().toISOString(),
        }));
      }

      if (Date.now() >= nextHeartbeatAt) {
        const heartbeat = await sql.unsafe(
          'SELECT aviator.heartbeat_crash_engine_lease($1::uuid,$2::integer) AS renewed',
          [ownerToken, LEASE_TTL_SECONDS],
        );
        if (heartbeat[0]?.renewed !== true) {
          ownsLease = false;
          console.warn(JSON.stringify({ event: 'aviator_worker_lease_lost', workerId: ownerToken, at: new Date().toISOString() }));
          await sleep(1_000);
          continue;
        }
        nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS;
      }

      await sleep(TICK_INTERVAL_MS);
    }
  } catch (error) {
    logWorkerError('Aviator Node.js engine worker stopped after an unrecoverable error.', error);
  } finally {
    if (ownsLease) {
      try {
        await sql.unsafe('SELECT aviator.release_crash_engine_lease($1::uuid)', [ownerToken]);
      } catch (error) {
        logWorkerError('Aviator Node.js engine worker could not release its lease.', error);
      }
    }
  }
}

export function startProductionCrashEngine() {
  if (workerRunning) return;
  workerRunning = true;
  workerPromise = (async () => {
    while (workerRunning) {
      await runWorker();
      if (workerRunning) {
        console.warn('Aviator Node.js worker loop exited; supervisor will retry lease acquisition in 5 seconds.');
        await sleep(5_000);
      }
    }
  })().finally(() => {
    workerRunning = false;
    workerPromise = null;
  });
  console.log('Aviator authoritative game engine started in the Node.js backend; Supabase is used for persistence, atomic wallet RPCs and Realtime delivery.');
}

export async function stopProductionCrashEngine(): Promise<void> {
  workerRunning = false;
  const stopping = workerPromise;
  if (stopping) await stopping.catch((error) => logWorkerError('Aviator Node.js worker shutdown failed.', error));
}
