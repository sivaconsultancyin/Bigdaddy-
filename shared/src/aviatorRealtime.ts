/**
 * Read a live Aviator multiplier from the public Realtime payload.
 * The crash target is intentionally never accepted while a round is RUNNING.
 */
export function readRunningRealtimeMultiplier(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (value.status !== 'RUNNING') return null;
  const rawMultiplier = value.multiplier;
  if (typeof rawMultiplier !== 'number' && typeof rawMultiplier !== 'string') return null;
  const multiplier = Number(rawMultiplier);
  return Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : null;
}


export interface RealtimeEventCursor {
  roundId: string;
  tickSequence: number;
  serverTime: number | null;
}

/** Read the public per-round tick cursor and optional server timestamp. */
export function readRealtimeEventCursor(payload: unknown): RealtimeEventCursor | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  const tickSequence = Number(value.tickSequence);
  if (!Number.isSafeInteger(tickSequence) || tickSequence < 0) return null;

  const rawServerTime = value.serverTime;
  let serverTime: number | null = null;
  if (typeof rawServerTime === 'number' && Number.isFinite(rawServerTime)) {
    serverTime = rawServerTime;
  } else if (typeof rawServerTime === 'string') {
    const parsed = Date.parse(rawServerTime);
    if (Number.isFinite(parsed)) serverTime = parsed;
  }

  return { roundId: value.id, tickSequence, serverTime };
}

/** Reject duplicate or out-of-order multiplier events within the same round. */
export function isNewerRealtimeEvent(
  payload: unknown,
  previous: RealtimeEventCursor | null,
): boolean {
  const next = readRealtimeEventCursor(payload);
  if (!next || !previous || next.roundId !== previous.roundId) return true;
  return next.tickSequence > previous.tickSequence;
}


/** Prevent a delayed state snapshot from rolling the UI back to an older round or phase. */
export function isNewerRoundSnapshot(
  incoming: unknown,
  current: unknown,
): boolean {
  if (!incoming || typeof incoming !== 'object') return false;
  const next = incoming as Record<string, unknown>;
  if (typeof next.id !== 'string' || next.id.length === 0) return false;
  if (!current || typeof current !== 'object') return true;

  const previous = current as Record<string, unknown>;
  if (typeof previous.id !== 'string' || previous.id.length === 0) return true;

  const nextNumber = Number(next.roundNumber);
  const previousNumber = Number(previous.roundNumber);
  const hasNextNumber = Number.isSafeInteger(nextNumber) && nextNumber > 0;
  const hasPreviousNumber = Number.isSafeInteger(previousNumber) && previousNumber > 0;

  if (hasNextNumber && hasPreviousNumber && nextNumber !== previousNumber) {
    return nextNumber > previousNumber;
  }
  if (next.id !== previous.id) return false;

  const rank: Record<string, number> = {
    WAITING: 0,
    BETTING: 0,
    RUNNING: 1,
    CRASHED: 2,
    RESULT: 2,
    SETTLED: 3,
  };
  const nextRank = rank[String(next.status ?? '')];
  const previousRank = rank[String(previous.status ?? '')];
  if (nextRank === undefined || previousRank === undefined) return true;
  return nextRank >= previousRank;
}
