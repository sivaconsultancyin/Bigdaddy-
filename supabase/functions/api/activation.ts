export type GameActivationReadinessInput = {
  gameCode: string; catalogWalletId: string; mappedWalletId: string;
  walletType: string; walletGameCode: string; balance: string; reservedBalance: string;
  minimumPoolBalance?: string;
  runtimeRoundStatus?: string | null;
};
export type GameActivationReadiness =
  | { ok: true; availablePoolBalance: string }
  | { ok: false; error: string; status: number };
export function evaluateGameActivationReadiness(input: GameActivationReadinessInput): GameActivationReadiness {
  if (!['aviator', 'roulette', 'dice', 'andar_bahar', 'dragon_tiger'].includes(input.gameCode)) return { ok: false, error: 'GAME_NOT_AVAILABLE_IN_PRODUCTION', status: 503 };
  if (!input.catalogWalletId || input.catalogWalletId !== input.mappedWalletId) return { ok: false, error: 'GAME_POOL_MAPPING_MISMATCH', status: 409 };
  if (input.walletType !== 'GAME_POOL' || input.walletGameCode !== input.gameCode) return { ok: false, error: 'GAME_POOL_IDENTITY_MISMATCH', status: 409 };
  if (!/^[0-9]+$/.test(input.balance) || !/^[0-9]+$/.test(input.reservedBalance)) return { ok: false, error: 'GAME_POOL_BALANCE_INVALID', status: 503 };
  const total = BigInt(input.balance), reserved = BigInt(input.reservedBalance);
  if (reserved > total) return { ok: false, error: 'GAME_POOL_LIABILITY_MISMATCH', status: 409 };
  const available = total - reserved;
  if (available <= 0n) return { ok: false, error: 'ALLOCATE_GAME_POOL_TOKENS_FIRST', status: 400 };
  if (input.gameCode === 'dice' && input.minimumPoolBalance && available < BigInt(input.minimumPoolBalance)) return { ok: false, error: 'DICE_POOL_LIQUIDITY_INSUFFICIENT', status: 400 };
  if (input.gameCode === 'andar_bahar' && input.minimumPoolBalance && available < BigInt(input.minimumPoolBalance)) return { ok: false, error: 'ANDAR_BAHAR_POOL_LIQUIDITY_INSUFFICIENT', status: 400 };
  if (input.gameCode === 'dragon_tiger' && input.minimumPoolBalance && available < BigInt(input.minimumPoolBalance)) return { ok: false, error: 'DRAGON_TIGER_POOL_LIQUIDITY_INSUFFICIENT', status: 400 };
  if (input.gameCode === 'aviator' && !['WAITING', 'RUNNING'].includes(String(input.runtimeRoundStatus ?? ''))) return { ok: false, error: 'AVIATOR_RUNTIME_UNAVAILABLE', status: 503 };
  return { ok: true, availablePoolBalance: available.toString() };
}

export type AndarBaharPublicDeal = {
  jokerCard: any | null;
  dealCards: any[];
  winningSide: 'andar' | 'bahar' | null;
  winningCard: any | null;
  totalCardsDealt: number;
};
export function getAndarBaharPublicDeal(
  result: any,
  status: string,
  dealStartedAt: string | null | undefined,
  nowMs = Date.now(),
): AndarBaharPublicDeal {
  const cards = Array.isArray(result?.dealCards) ? result.dealCards : [];
  let visible = 0;
  if (status === 'SETTLED') visible = cards.length;
  else if (status === 'RUNNING' && dealStartedAt) {
    const startedAt = new Date(dealStartedAt).getTime();
    if (Number.isFinite(startedAt)) {
      const elapsed = Math.max(0, nowMs - startedAt);
      visible = Math.min(cards.length, Math.ceil((elapsed / 4500) * cards.length));
    }
  }
  const dealCards = cards.slice(0, visible);
  const settled = status === 'SETTLED';
  return {
    jokerCard: result?.jokerCard ?? null,
    dealCards,
    winningSide: settled && (result?.winner === 'andar' || result?.winner === 'bahar') ? result.winner : null,
    winningCard: settled ? dealCards[dealCards.length - 1]?.card ?? null : null,
    totalCardsDealt: dealCards.length,
  };
}
