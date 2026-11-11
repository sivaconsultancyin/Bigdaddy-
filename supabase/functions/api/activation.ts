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
  if (!['aviator', 'roulette', 'dice', 'andar_bahar'].includes(input.gameCode)) return { ok: false, error: 'GAME_NOT_AVAILABLE_IN_PRODUCTION', status: 503 };
  if (!input.catalogWalletId || input.catalogWalletId !== input.mappedWalletId) return { ok: false, error: 'GAME_POOL_MAPPING_MISMATCH', status: 409 };
  if (input.walletType !== 'GAME_POOL' || input.walletGameCode !== input.gameCode) return { ok: false, error: 'GAME_POOL_IDENTITY_MISMATCH', status: 409 };
  if (!/^[0-9]+$/.test(input.balance) || !/^[0-9]+$/.test(input.reservedBalance)) return { ok: false, error: 'GAME_POOL_BALANCE_INVALID', status: 503 };
  const total = BigInt(input.balance), reserved = BigInt(input.reservedBalance);
  if (reserved > total) return { ok: false, error: 'GAME_POOL_LIABILITY_MISMATCH', status: 409 };
  const available = total - reserved;
  if (available <= 0n) return { ok: false, error: 'ALLOCATE_GAME_POOL_TOKENS_FIRST', status: 400 };
  if (input.gameCode === 'dice' && input.minimumPoolBalance && available < BigInt(input.minimumPoolBalance)) return { ok: false, error: 'DICE_POOL_LIQUIDITY_INSUFFICIENT', status: 400 };
  if (input.gameCode === 'aviator' && !['WAITING', 'RUNNING'].includes(String(input.runtimeRoundStatus ?? ''))) return { ok: false, error: 'AVIATOR_RUNTIME_UNAVAILABLE', status: 503 };
  return { ok: true, availablePoolBalance: available.toString() };
}
