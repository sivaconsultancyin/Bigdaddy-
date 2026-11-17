export const MAX_TOKEN_SUPPLY = '10000000000'; // Exactly 10 Billion tokens
export const MAX_TOKEN_SUPPLY_BIGINT = 10000000000n;

export const SYSTEM_WALLETS = {
  TREASURY: 'wallet-system-treasury',
  BET_ESCROW: 'wallet-system-escrow',
  AVIATOR_POOL: 'wallet-pool-aviator',
  ROULETTE_POOL: 'wallet-pool-roulette',
  DICE_POOL: 'wallet-pool-dice',
  ANDAR_BAHAR_POOL: 'wallet-pool-andar-bahar',
};

export const GAMES_CATALOG = [
  {
    id: 'game-aviator',
    code: 'aviator',
    name: 'Aviator / Crash',
    status: 'ACTIVE',
    poolWalletId: SYSTEM_WALLETS.AVIATOR_POOL,
    minBet: '10',
    maxBet: '100000',
    description: 'Real-time multiplayer crash game with rising multiplier and instant cashouts.',
    iconName: 'Plane',
    route: '/games/aviator',
  },
  {
    id: 'game-roulette',
    code: 'roulette',
    name: 'European Roulette',
    status: 'ACTIVE',
    poolWalletId: SYSTEM_WALLETS.ROULETTE_POOL,
    minBet: '10',
    maxBet: '250000',
    description: 'Classic 37-pocket casino roulette with inside & outside betting options.',
    iconName: 'Disc',
    route: '/games/roulette',
  },
  {
    id: 'game-dice',
    code: 'dice',
    name: 'Provably Fair Dice',
    status: 'ACTIVE',
    poolWalletId: SYSTEM_WALLETS.DICE_POOL,
    minBet: '10',
    maxBet: '100000',
    description: 'Custom target roll over/under dice with customizable payout odds.',
    iconName: 'Dice5',
    route: '/games/dice',
  },
  {
    id: 'game-andar-bahar',
    code: 'andar-bahar',
    name: 'Andar Bahar',
    status: 'ACTIVE',
    poolWalletId: SYSTEM_WALLETS.ANDAR_BAHAR_POOL,
    minBet: '10',
    maxBet: '200000',
    description: 'Synchronized live Indian card game matching joker rank on Andar or Bahar.',
    iconName: 'Layers',
    route: '/games/andar-bahar',
  },
];
