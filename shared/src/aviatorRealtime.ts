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
