export type RouletteBetPayload = {
  bets: Array<{ type: string; numbers: number[]; amount: string }>;
};

/**
 * Deterministic identity for one user's Roulette bet intent.
 * Including the user and round prevents a pending key from leaking across
 * account changes or being replayed in a later round.
 */
export function buildRouletteBetOperation(
  userId: string,
  roundId: string,
  payload: RouletteBetPayload,
): string {
  const user = String(userId ?? '').trim();
  const round = String(roundId ?? '').trim();
  if (!user || !round || !Array.isArray(payload?.bets) || payload.bets.length === 0) {
    throw new Error('ROULETTE_BET_INTENT_REQUIRED');
  }

  const canonicalPayload = {
    bets: payload.bets.map((bet) => ({
      type: String(bet.type ?? '').trim(),
      numbers: Array.isArray(bet.numbers) ? [...bet.numbers] : [],
      amount: String(bet.amount ?? '').trim(),
    })),
  };
  return `roulette-bet:${user}:${round}:${JSON.stringify(canonicalPayload)}`;
}


export type DragonTigerBetPayload = {
  bets: Array<{ type: string; amount: string }>;
};

/**
 * One pending Dragon Tiger bet intent per user and canonical payload.
 * The key deliberately survives round transitions and page reloads while the
 * outcome is uncertain; a successful response clears it so a later intentional
 * identical bet receives a fresh key.
 */
export function buildDragonTigerBetOperation(
  userId: string,
  payload: DragonTigerBetPayload,
): string {
  const user = String(userId ?? '').trim();
  if (!user || !Array.isArray(payload?.bets) || payload.bets.length === 0) {
    throw new Error('DRAGON_TIGER_BET_INTENT_REQUIRED');
  }
  const canonicalPayload = {
    bets: payload.bets.map((bet) => ({
      type: String(bet.type ?? '').trim().toLowerCase(),
      amount: String(bet.amount ?? '').trim(),
    })),
  };
  return `dragon-tiger-bet:${user}:${JSON.stringify(canonicalPayload)}`;
}
