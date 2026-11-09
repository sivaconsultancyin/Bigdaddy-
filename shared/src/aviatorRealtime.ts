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
