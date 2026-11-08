import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type EngineTickResult = {
  action?: string;
  roundId?: string;
  roundNumber?: number;
  crashMultiplier?: number | string;
  betsSettled?: number;
  multiplier?: number;
};

const LEASE_TTL_SECONDS = 45;
const HEARTBEAT_INTERVAL_MS = 5_000;
let workerRunning = false;
let workerPromise: Promise<void> | null = null;
let lastErrorAt = 0;
let client: SupabaseClient | null = null;

function getEngineClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error('Aviator worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'bigdaddy-aviator-worker' } },
  });
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function logWorkerError(message: string, error: unknown) {
  if (Date.now() - lastErrorAt < 15_000) return;
  console.error(message, error instanceof Error ? error.message : String(error));
  lastErrorAt = Date.now();
}

async function runWorker(): Promise<void> {
  const ownerToken = crypto.randomUUID();
  let ownsLease = false;
  let nextHeartbeatAt = 0;
  let db: SupabaseClient;
  try {
    db = getEngineClient();
    while (workerRunning) {
      if (!ownsLease) {
        const claim = await db.schema('aviator').rpc('claim_crash_engine_lease', {
          p_owner_token: ownerToken,
          p_ttl_seconds: LEASE_TTL_SECONDS,
        });
        if (claim.error) {
          logWorkerError('Aviator backend worker lease claim failed.', claim.error);
          await sleep(5_000);
          continue;
        }
        ownsLease = claim.data === true;
        if (!ownsLease) {
          await sleep(5_000);
          continue;
        }
        nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS;
        console.info('Aviator backend worker acquired the distributed engine lease.');
      }

      const { data, error } = await db.schema('aviator').rpc('tick_crash_engine_with_broadcast');
      const result = data as EngineTickResult | null;
      if (error) {
        logWorkerError('Aviator backend worker tick failed.', error);
      } else if (result && ['round_created', 'round_started', 'round_crashed', 'settled_recovery'].includes(result.action ?? '')) {
        console.info('Aviator Supabase engine state transition.', result);
      }

      if (Date.now() >= nextHeartbeatAt) {
        const heartbeat = await db.schema('aviator').rpc('heartbeat_crash_engine_lease', {
          p_owner_token: ownerToken,
          p_ttl_seconds: LEASE_TTL_SECONDS,
        });
        if (heartbeat.error || heartbeat.data !== true) {
          ownsLease = false;
          console.warn('Aviator backend worker lost its lease; it will retry acquisition without ticking.');
          await sleep(1_000);
          continue;
        }
        nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS;
      }

      const action = error ? 'rpc_error' : (result?.action ?? 'unknown');
      const delayMs = action === 'rpc_error' ? 1_000
        : action === 'round_running' ? 250
        : action === 'round_started' ? 150
        : action === 'waiting' || action === 'round_created' ? 500
        : action === 'cooldown' || action === 'busy' ? 1_000
        : 750;
      await sleep(delayMs);
    }
  } catch (error) {
    logWorkerError('Aviator backend worker stopped after an unrecoverable error.', error);
  } finally {
    if (ownsLease) {
      const released = await db.schema('aviator').rpc('release_crash_engine_lease', {
        p_owner_token: ownerToken,
      });
      if (released.error) logWorkerError('Aviator backend worker could not release its lease.', released.error);
    }
  }
}

export function startProductionCrashEngine() {
  if (workerRunning) return;
  workerRunning = true;
  workerPromise = runWorker().finally(() => {
    workerRunning = false;
    workerPromise = null;
  });
  console.log('Aviator scheduler started with a shared distributed lease; engine ticks and multiplier broadcasts use Supabase RPC.');
}

export function stopProductionCrashEngine() {
  workerRunning = false;
  // runWorker observes the stop flag after the current RPC/sleep and releases
  // the lease in its finally block.
  void workerPromise;
}
