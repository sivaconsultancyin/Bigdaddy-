import { getEngineDatabaseClient } from '../../db/postgres';

let interval: NodeJS.Timeout | null = null;
let busy = false;
let lastErrorAt = 0;

type EngineTickResult = {
  action?: string;
  roundId?: string;
  roundNumber?: number;
  crashMultiplier?: number | string;
  betsSettled?: number;
  multiplier?: number;
};

async function tick() {
  // Keep the scheduler process non-overlapping. PostgreSQL also owns an advisory
  // transaction lock, so duplicate workers cannot advance the same round.
  if (busy) return;
  busy = true;

  try {
    const client = getEngineDatabaseClient();
    const rows = await client.unsafe(
      'SELECT aviator.tick_crash_engine() AS result',
    );
    const result = rows[0]?.result as EngineTickResult | undefined;

    if (result && ['round_created', 'round_started', 'round_crashed', 'settled_recovery'].includes(result.action ?? '')) {
      console.info('Aviator Supabase engine state transition.', result);
    }
  } catch (error) {
    if (Date.now() - lastErrorAt > 15000) {
      console.error('Aviator Supabase engine tick failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
      lastErrorAt = Date.now();
    }
  } finally {
    busy = false;
  }
}

export function startProductionCrashEngine() {
  if (interval) return;
  interval = setInterval(() => { void tick(); }, 1000);
  void tick();
  console.log('Aviator scheduler started; round state, fairness, crash, auto-cashout and settlement logic run in Supabase PostgreSQL.');
}

export function stopProductionCrashEngine() {
  if (interval) clearInterval(interval);
  interval = null;
}
