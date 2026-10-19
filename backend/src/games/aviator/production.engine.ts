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
    const sql = getDatabaseClient();
    const games = await sql.unsafe("SELECT id,pool_wallet_id FROM public.games WHERE code='aviator' AND status='ACTIVE' LIMIT 1");
    if (!games[0]) return;

    let rows = await sql.unsafe("SELECT id,round_number,status,started_at,server_seed,crash_multiplier FROM public.game_rounds WHERE game_code='aviator' ORDER BY round_number DESC LIMIT 1");
    if (!rows[0] || rows[0].status === 'SETTLED') {
      const maxRows = await sql.unsafe("SELECT COALESCE(MAX(round_number),0)::bigint AS n FROM public.game_rounds WHERE game_code='aviator'");
      const roundNumber = Number(maxRows[0].n) + 1;
      const seed = randomBytes(32).toString('hex');
      const commitment = createHash('sha256').update(seed).digest('hex');
      const crash = fairCrashMultiplier(seed, roundNumber);
      await sql.unsafe("INSERT INTO public.game_rounds(game_code,round_number,status,server_seed,server_seed_hash,crash_multiplier,started_at) VALUES('aviator',$1,'WAITING',$2,$3,$4,now())", [roundNumber, seed, commitment, crash]);
      return;
    }

    const round = rows[0] as { id: string; round_number: number; status: string; started_at: string; server_seed: string; crash_multiplier: string | number };
    const age = Date.now() - new Date(round.started_at).getTime();
    if (round.status === 'WAITING') {
      if (age >= 5000) {
        await sql.unsafe("UPDATE public.game_rounds SET status='RUNNING',started_at=now() WHERE id=$1 AND status='WAITING'", [round.id]);
      }
      return;
    }
    if (round.status === 'RUNNING') {
      const multiplier = Math.floor(Math.exp(0.06 * Math.pow(Math.max(0, age / 1000), 1.15)) * 100) / 100;
      const crash = Number(round.crash_multiplier);
      if (multiplier >= crash) {
        await sql.unsafe("UPDATE public.game_rounds SET status='CRASHED',ended_at=now(),revealed_server_seed=server_seed WHERE id=$1 AND status='RUNNING'", [round.id]);
        await sql.unsafe('SELECT public.settle_crash_round_atomic($1::uuid)', [round.id]);
        return;
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
