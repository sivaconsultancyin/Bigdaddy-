import { Router, Request, Response, NextFunction } from 'express';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getDatabaseClient } from '../db/postgres';
import { AuthService } from '../services/auth.service';

export const authoritativeGamesRouter = Router();
type Actor = { id: string; username: string; role: string };
type AuthRequest = Request & { actor?: Actor };
export type GameCode = 'roulette' | 'dice' | 'dragon_tiger' | 'andar_bahar';
export function isPlayerRole(role: unknown): boolean {
  return String(role ?? '').toUpperCase() === 'PLAYER';
}

export function isCompatibleIdempotencyReplay(
  existing: any,
  code: GameCode,
  userId: string,
  amount: unknown,
): boolean {
  return Boolean(
    existing &&
    existing.game_code === code &&
    existing.user_id === userId &&
    String(existing.amount) === String(amount)
  );
}

export function canReserveLiability(balance: unknown, reserved: unknown, liability: unknown): boolean {
  try {
    const total = BigInt(String(balance));
    const alreadyReserved = BigInt(String(reserved));
    const required = BigInt(String(liability));
    if (total < 0n || alreadyReserved < 0n || required < 0n) return false;
    const available = total - alreadyReserved;
    return available >= required;
  } catch {
    return false;
  }
}

export function canSettleRound(status: unknown, result: unknown): boolean {
  return status === 'RESULT' && Boolean(result);
}

const GAME_CODES: GameCode[] = ['roulette', 'dice', 'dragon_tiger', 'andar_bahar'];
const CODE_ALIASES: Record<string, GameCode> = {
  roulette: 'roulette',
  dice: 'dice',
  'dragon-tiger': 'dragon_tiger',
  dragon_tiger: 'dragon_tiger',
  'andar-bahar': 'andar_bahar',
  andar_bahar: 'andar_bahar',
};
const BETTING_MS = 15000;
let engineTimer: NodeJS.Timeout | null = null;
let engineBusy = false;
let lastSchemaWarningAt = 0;

async function hasRuntimeSchema(): Promise<boolean> {
  const rows = await getDatabaseClient().unsafe(
    "SELECT to_regclass('public.authoritative_game_rounds') AS rounds, to_regclass('public.authoritative_game_bets') AS bets",
  );
  return Boolean(rows[0]?.rounds && rows[0]?.bets);
}

async function auth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const token = AuthService.verifyToken(header.slice(7));
    if (!token?.id) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const rows = await getDatabaseClient().unsafe(
      'SELECT id,username,role FROM public.users WHERE id=$1 AND is_active=true LIMIT 1', [token.id],
    );
    if (!rows[0]) return res.status(401).json({ error: 'USER_NOT_FOUND_OR_DISABLED' });
    if (!isPlayerRole(rows[0].role)) {
      return res.status(403).json({ error: 'PLAYER_ROLE_REQUIRED' });
    }
    req.actor = rows[0] as unknown as Actor;
    return next();
  } catch (error) {
    console.error('Authoritative game auth failed:', error);
    return res.status(503).json({ error: 'GAME_AUTH_UNAVAILABLE' });
  }
}

function codeFromParam(value: string): GameCode | null {
  return CODE_ALIASES[value] || null;
}
function stableInt(seed: string, label: string, maxExclusive: number): number {
  const hex = createHmac('sha256', seed).update(label).digest('hex').slice(0, 13);
  return Number(BigInt('0x' + hex) % BigInt(maxExclusive));
}
function shuffledDeck(seed: string, deckCount = 1): Array<{ rank: number; suit: string; code: string; deckIndex: number }> {
  const suits = ['S', 'H', 'D', 'C'];
  const deck = Array.from({ length: deckCount }, (_, deckIndex) => suits.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({
    rank: i + 2, suit, deckIndex, code: (['2','3','4','5','6','7','8','9','10','J','Q','K','A'][i] + suit),
  })))).flat();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = stableInt(seed, 'deck:' + i, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function rouletteColor(number: number): 'red' | 'black' | 'green' {
  if (number === 0) return 'green';
  const red = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  return red.has(number) ? 'red' : 'black';
}
export function makeResult(code: GameCode, seed: string): Record<string, any> {
  if (code === 'roulette') {
    const number = stableInt(seed, 'roulette', 37);
    return { number, color: rouletteColor(number) };
  }
  if (code === 'dice') {
    const number = stableInt(seed, 'dice', 10) + 1;
    return { number, rolledNumber: number };
  }
  if (code === 'dragon_tiger') {
    const deck = shuffledDeck(seed, 8);
    const dragonCard = deck[0];
    const tigerCard = deck[1];
    const dragonValue = dragonCard.rank === 14 ? 1 : dragonCard.rank;
    const tigerValue = tigerCard.rank === 14 ? 1 : tigerCard.rank;
    const winner = dragonValue === tigerValue ? (dragonCard.suit === tigerCard.suit ? 'suited_tie' : 'tie') : dragonValue > tigerValue ? 'dragon' : 'tiger';
    return { dragonCard, tigerCard, winner };
  }
  const deck = shuffledDeck(seed);
  const jokerCard = deck[0];
  const cards = deck.slice(1);
  const dealCards: Array<{ side: 'andar' | 'bahar'; card: { rank: number; suit: string; code: string } }> = [];
  let winner: 'andar' | 'bahar' = 'bahar';
  for (let i = 0; i < cards.length; i++) {
    const side: 'andar' | 'bahar' = i % 2 === 0 ? 'bahar' : 'andar';
    dealCards.push({ side, card: cards[i] });
    if (cards[i].rank === jokerCard.rank) { winner = side; break; }
  }
  return { jokerCard, dealCards, winner, totalCardsDealt: dealCards.length };
}
export function payoutMultiplier(code: GameCode, selection: any, result: any): number {
  const type = String(selection?.type || '').toLowerCase();
  if (code === 'roulette') {
    const number = Number(result.number);
    const numbers = Array.isArray(selection?.numbers) ? selection.numbers.map(Number) : [];
    if (['straight','split','street','corner','line','number'].includes(type)) {
      const odds: Record<string, number> = { straight: 36, number: 36, split: 18, street: 12, corner: 9, line: 6 };
      return numbers.includes(number) ? odds[type] : 0;
    }
    if (type === 'red' || type === 'black' || type === 'green') return result.color === type ? (type === 'green' ? 36 : 2) : 0;
    if (type === 'odd' || type === 'even') return number !== 0 && (type === 'odd' ? number % 2 === 1 : number % 2 === 0) ? 2 : 0;
    if (type === 'low' || type === '1-18') return number >= 1 && number <= 18 ? 2 : 0;
    if (type === 'high' || type === '19-36') return number >= 19 && number <= 36 ? 2 : 0;
    if (type.startsWith('dozen')) {
      const dozen = Number(type.replace('dozen', '') || selection?.dozen || selection?.value);
      return number > 0 && Math.ceil(number / 12) === dozen ? 3 : 0;
    }
    if (type.startsWith('col')) {
      const column = Number(type.replace('col', '') || selection?.column || selection?.value);
      return number > 0 && (number - 1) % 3 + 1 === column ? 3 : 0;
    }
    return 0;
  }
  if (code === 'dice') {
    const number = Number(result.number);
    if (type === 'number' || /^\d+$/.test(type)) return Number(selection?.value ?? type) === number ? 10 : 0;
    if (type === 'odd' || type === 'even') return (type === 'odd' ? number % 2 === 1 : number % 2 === 0) ? 2 : 0;
    if (type === 'small') return number <= 5 ? 2 : 0;
    if (type === 'big') return number >= 6 ? 2 : 0;
    if (type === 'over') return number > Number(selection?.value) ? 2 : 0;
    if (type === 'under') return number < Number(selection?.value) ? 2 : 0;
    return 0;
  }
  if (code === 'dragon_tiger') {
    if (type === 'dragon' || type === 'tiger') return type === result.winner ? 2 : 0;
    if (type === 'tie') return result.winner === 'tie' || result.winner === 'suited_tie' ? 9 : 0;
    if (type === 'suited_tie') return result.winner === 'suited_tie' ? 51 : 0;
    if (type === 'dragon_big') return result.dragonCard.rank >= 8 ? 2 : 0;
    if (type === 'dragon_small') return result.dragonCard.rank <= 6 ? 2 : 0;
    if (type === 'tiger_big') return result.tigerCard.rank >= 8 ? 2 : 0;
    if (type === 'tiger_small') return result.tigerCard.rank <= 6 ? 2 : 0;
    return 0;
  }
  return type === result.winner ? 2 : 0;
}

export function maxLiabilityMultiplier(code: GameCode, selection: any): number {
  const type = String(selection?.type || '').toLowerCase();
  if (code === 'roulette') {
    if (type === 'straight' || type === 'number') return 36;
    if (type === 'split') return 18;
    if (type === 'street') return 12;
    if (type === 'corner') return 9;
    if (type === 'line') return 6;
    if (type.startsWith('dozen') || type.startsWith('col') || type === 'dozen' || type === 'column') return 3;
    if (type === 'green') return 36;
    return 2;
  }
  if (code === 'dice') return (type === 'number' || /^\d+$/.test(type)) ? 10 : 2;
  if (code === 'dragon_tiger') return type === 'suited_tie' ? 51 : type === 'tie' ? 9 : 2;
  return 2;
}
export function validateSelection(code: GameCode, selection: any): boolean {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return false;
  const type = String(selection.type || '').toLowerCase();
  if (code === 'roulette') {
    if (['red','black','green','odd','even','low','high','1-18','19-36','dozen1','dozen2','dozen3','col1','col2','col3'].includes(type)) return true;
    if (['straight','split','street','corner','line','number'].includes(type) && Array.isArray(selection.numbers)) {
      const expected: Record<string, number> = { straight: 1, split: 2, street: 3, corner: 4, line: 6, number: 1 };
      return selection.numbers.length === expected[type] &&
        selection.numbers.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 36);
    }
    if (type === 'dozen') return [1,2,3].includes(Number(selection.dozen || selection.value));
    if (type === 'column') return [1,2,3].includes(Number(selection.column || selection.value));
    return false;
  }
  if (code === 'dice') {
    if (type === 'number' || /^\d+$/.test(type)) return Number.isInteger(Number(selection.value ?? type)) && Number(selection.value ?? type) >= 1 && Number(selection.value ?? type) <= 10;
    if (['odd','even','small','big'].includes(type)) return true;
    if (type === 'over' || type === 'under') return Number.isInteger(Number(selection.value)) && Number(selection.value) >= 1 && Number(selection.value) <= 9;
    return false;
  }
  if (code === 'dragon_tiger') return ['dragon','tiger','tie','suited_tie','dragon_big','dragon_small','tiger_big','tiger_small'].includes(type);
  return ['andar','bahar'].includes(type);
}

function publicRound(row: any, code: GameCode) {
  const state = row.state || {};
  const result = ['RUNNING','RESULT','SETTLED'].includes(row.status) ? row.result : null;
  return {
    id: row.id,
    roundNumber: Number(row.round_number),
    status: row.status === 'SETTLED' ? 'RESULT' : row.status === 'RUNNING' ? (code === 'roulette' ? 'SPINNING' : code === 'dice' ? 'ROLLING' : code === 'dragon_tiger' ? 'REVEALING' : 'DEALING') : row.status,
    bettingEndsAt: new Date(row.betting_closes_at).getTime(),
    ...(code === 'roulette' ? { spinEndsAt: new Date(row.betting_closes_at).getTime() + 1500 } : {}),
    openedAt: new Date(row.opened_at).getTime(),
    ...(code === 'roulette' ? {
      winningNumber: result?.number ?? null, color: result?.color ?? null,
    } : {}),
    ...(code === 'dice' ? { rolledNumber: result?.number ?? null, numberBetsAmount: {} } : {}),
    ...(code === 'dragon_tiger' ? {
      dragonCard: result?.dragonCard ?? null, tigerCard: result?.tigerCard ?? null, winner: result?.winner ?? null,
    } : {}),
    ...(code === 'andar_bahar' ? {
      jokerCard: result?.jokerCard ?? null, dealCards: result?.dealCards ?? [],
      winningSide: result?.winner ?? null, winningCard: result?.dealCards?.[Math.max(0, (result?.dealCards?.length || 1) - 1)]?.card ?? null,
      totalCardsDealt: result?.totalCardsDealt ?? 0, firstSide: 'bahar',
    } : {}),
    totalBetsCount: Number(state.totalBetsCount || 0),
    totalBetAmount: String(state.totalBetAmount || '0'),
    ...(code === 'dragon_tiger' ? { dragonBetAmount: '0', tigerBetAmount: '0', tieBetAmount: '0' } : {}),
    ...(code === 'andar_bahar' ? { andarBetAmount: '0', baharBetAmount: '0' } : {}),
    serverSeedHash: row.server_seed_hash,
    revealedServerSeed: row.status === 'SETTLED' ? row.server_seed : null,
  };
}

async function readGameState(code: GameCode) {
  const sql = getDatabaseClient();
  const rounds = await sql.unsafe(
    'SELECT * FROM public.authoritative_game_rounds WHERE game_code=$1 ORDER BY round_number DESC LIMIT 1', [code],
  );
  const history = await sql.unsafe(
    'SELECT id,round_number,status,result,settled_at FROM public.authoritative_game_rounds WHERE game_code=$1 AND status=\'SETTLED\' ORDER BY round_number DESC LIMIT 25', [code],
  );
  const bets = rounds[0] ? await sql.unsafe(
    'SELECT b.id,b.bet_amount::text AS amount,b.selection,b.status,b.payout_amount::text AS "payoutAmount",u.username FROM public.authoritative_game_bets b JOIN public.users u ON u.id=b.user_id WHERE b.round_id=$1 ORDER BY b.created_at DESC LIMIT 100',
    [rounds[0].id],
  ) : [];
  const current: any = rounds[0] ? publicRound(rounds[0], code) : null;
  if (current) {
    const aggregateRows = await sql.unsafe(
      'SELECT selection->>\'type\' AS type, COALESCE(sum(bet_amount),0)::text AS amount FROM public.authoritative_game_bets WHERE round_id=$1 GROUP BY selection->>\'type\'',
      [rounds[0].id],
    );
    const totals: Record<string, bigint> = {};
    for (const row of aggregateRows as any[]) {
      totals[String(row.type || '')] = BigInt(String(row.amount || 0));
    }
    if (code === 'dragon_tiger') {
      current.dragonBetAmount = String(totals.dragon || 0n);
      current.tigerBetAmount = String(totals.tiger || 0n);
      current.tieBetAmount = String((totals.tie || 0n) + (totals.suited_tie || 0n));
    }
    if (code === 'andar_bahar') {
      current.andarBetAmount = String(totals.andar || 0n);
      current.baharBetAmount = String(totals.bahar || 0n);
    }
    if (code === 'dice') current.numberBetsAmount = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, String(value)]));
  }
  return {
    round: current,
    history: history.map((r: any) => ({ roundNumber: Number(r.round_number), result: r.result, timestamp: r.settled_at })),
    bets: bets.map((b: any) => ({ id: b.id, amount: b.amount, type: b.selection.type, selection: b.selection, status: b.status, payoutAmount: b.payoutAmount, username: b.username })),
    allBets: bets.map((b: any) => ({ id: b.id, amount: b.amount, type: b.selection.type, selection: b.selection, status: b.status, payoutAmount: b.payoutAmount, username: b.username })),
  };
}

authoritativeGamesRouter.get('/games/:gameCode/state', async (req, res) => {
  const code = codeFromParam(req.params.gameCode);
  if (!code) return res.status(404).json({ error: 'UNKNOWN_GAME' });
  try {
    if (!(await hasRuntimeSchema())) return res.status(503).json({ error: 'GAME_RUNTIME_MIGRATION_REQUIRED' });
    const data = await readGameState(code);
    if (!data.round) return res.status(503).json({ error: 'GAME_NOT_CONFIGURED', gameCode: code });
    return res.json(data);
  } catch (error) {
    console.error('Authoritative game state read failed:', error);
    return res.status(503).json({ error: 'GAME_STATE_UNAVAILABLE' });
  }
});

async function placeBets(req: AuthRequest, res: Response, code: GameCode) {
  const rawBets = Array.isArray(req.body?.bets) ? req.body.bets : [req.body];
  if (!rawBets.length || rawBets.length > 20) return res.status(400).json({ error: 'INVALID_BET_COUNT' });
  const idempotencyBase = String(req.header('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (idempotencyBase.length < 8 || idempotencyBase.length > 110) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  for (const bet of rawBets) {
    const amount = Number(bet?.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !validateSelection(code, bet?.selection || bet)) {
      return res.status(400).json({ error: 'INVALID_BET' });
    }
  }
  try {
    const sql = getDatabaseClient();
    if (!(await hasRuntimeSchema())) return res.status(503).json({ error: 'GAME_RUNTIME_MIGRATION_REQUIRED' });
    const replayKeys = rawBets.map((_: any, index: number) => rawBets.length === 1 ? idempotencyBase : idempotencyBase + '_' + index);
    const existingRows = await sql.unsafe(
      'SELECT b.id,b.user_id,b.round_id,b.bet_amount::text AS amount,b.selection,b.status,b.payout_amount::text AS "payoutAmount",b.idempotency_key,r.game_code FROM public.authoritative_game_bets b JOIN public.authoritative_game_rounds r ON r.id=b.round_id WHERE b.idempotency_key = ANY($1::text[])',
      [replayKeys],
    );
    if (existingRows.length > 0) {
      if (existingRows.length !== rawBets.length) throw new Error('IDEMPOTENCY_KEY_REUSE');
      const replayBets = [];
      for (let i = 0; i < rawBets.length; i++) {
        const existing = existingRows.find((row: any) => row.idempotency_key === replayKeys[i]);
        const selection = rawBets[i].selection || rawBets[i];
        if (!existing || !isCompatibleIdempotencyReplay(existing, code, req.actor!.id, rawBets[i].amount)) {
          throw new Error('IDEMPOTENCY_KEY_REUSE');
        }
        const same = await sql.unsafe(
          'SELECT selection=$2::jsonb AS same FROM public.authoritative_game_bets WHERE id=$1',
          [existing.id, JSON.stringify(selection)],
        );
        if (!same[0]?.same) throw new Error('IDEMPOTENCY_KEY_REUSE');
        replayBets.push({ id: existing.id, status: existing.status, amount: existing.amount, payoutAmount: existing.payoutAmount, selection, replay: true });
      }
      return res.status(200).json({
        success: true,
        betCount: replayBets.length,
        totalBet: rawBets.reduce((sum: number, bet: any) => sum + Number(bet.amount), 0).toString(),
        placedBets: replayBets,
        ...(await readGameState(code)),
      });
    }
    const placed = await sql.begin(async (tx) => {
      const gameRows = await tx.unsafe(
        "SELECT id,pool_wallet_id,min_bet,max_bet FROM public.games WHERE code=$1 AND status='ACTIVE' LIMIT 1", [code],
      );
      const game = gameRows[0];
      if (!game?.pool_wallet_id) throw new Error('GAME_NOT_CONFIGURED');
      const roundRows = await tx.unsafe(
        "SELECT * FROM public.authoritative_game_rounds WHERE game_code=$1 AND status='BETTING' AND betting_closes_at>now() ORDER BY round_number DESC LIMIT 1 FOR UPDATE", [code],
      );
      const round = roundRows[0];
      if (!round) throw new Error('BETTING_CLOSED');
      const poolRows = await tx.unsafe("SELECT id,balance,reserved_balance FROM public.wallets WHERE id=$1", [game.pool_wallet_id]);
      const escrowRows = await tx.unsafe("SELECT id FROM public.wallets WHERE wallet_type='ESCROW' ORDER BY id LIMIT 1");
      if (!poolRows[0] || !escrowRows[0]) throw new Error('GAME_WALLETS_NOT_CONFIGURED');
      const result = [];
      for (let i = 0; i < rawBets.length; i++) {
        const input = rawBets[i];
        const amount = BigInt(String(input.amount));
        if (amount < BigInt(game.min_bet) || amount > BigInt(game.max_bet)) throw new Error('BET_OUT_OF_RANGE');
        const selection = input.selection || input;
        const liability = amount * BigInt(maxLiabilityMultiplier(code, selection));
        const key = rawBets.length === 1 ? idempotencyBase : idempotencyBase + '_' + i;
        const prior = await tx.unsafe('SELECT id,user_id,round_id,bet_amount,status,(selection=$2::jsonb) AS same_selection FROM public.authoritative_game_bets WHERE idempotency_key=$1', [key, JSON.stringify(selection)]);
        if (prior[0]) {
          if (prior[0].user_id !== req.actor!.id || prior[0].round_id !== round.id ||
              String(prior[0].bet_amount) !== String(amount) ||
              !prior[0].same_selection) throw new Error('IDEMPOTENCY_KEY_REUSE');
          result.push({ id: prior[0].id, status: prior[0].status || 'PENDING', replay: true });
          continue;
        }
        const playerRows = await tx.unsafe("SELECT id,balance FROM public.wallets WHERE user_id=$1 AND wallet_type='PLAYER' LIMIT 1", [req.actor!.id]);
        if (!playerRows[0]) throw new Error('PLAYER_WALLET_NOT_FOUND');
        // Acquire every wallet row in one stable order before changing reservations or balances.
        await tx.unsafe("SELECT id FROM public.wallets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[game.pool_wallet_id, escrowRows[0].id, playerRows[0].id]]);
        const fundsRows = await tx.unsafe("SELECT balance,reserved_balance FROM public.wallets WHERE id=$1", [game.pool_wallet_id]);
        if (!fundsRows[0] || !canReserveLiability(fundsRows[0].balance, fundsRows[0].reserved_balance || 0, liability)) {
          throw new Error('GAME_POOL_INSUFFICIENT');
        }
        await tx.unsafe("UPDATE public.wallets SET reserved_balance=reserved_balance+$2::bigint,updated_at=now() WHERE id=$1", [game.pool_wallet_id, liability.toString()]);
        const betRows = await tx.unsafe(
          "INSERT INTO public.authoritative_game_bets(round_id,user_id,bet_amount,selection,idempotency_key,reserved_liability) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id",
          [round.id, req.actor!.id, amount.toString(), JSON.stringify(selection), key, liability.toString()],
        );
        const betId = betRows[0].id as string;
        const txRows = await tx.unsafe(
          "SELECT public.wallet_transfer_atomic($1,'BET_ESCROW_LOCK'::public.transaction_type_enum,$2,$3::uuid,$4::uuid,$5::jsonb) AS id",
          ['AGAME_BET_' + key, amount.toString(), playerRows[0].id, escrowRows[0].id, JSON.stringify({ gameCode: code, roundId: round.id, betId })],
        );
        await tx.unsafe('UPDATE public.authoritative_game_bets SET escrow_transaction_id=$1 WHERE id=$2', [txRows[0].id, betId]);
        result.push({ id: betId, status: 'PENDING', amount: amount.toString(), selection });
      }
      await tx.unsafe(
        "UPDATE public.authoritative_game_rounds SET state=jsonb_set(jsonb_set(state,'{totalBetsCount}',to_jsonb((SELECT count(*) FROM public.authoritative_game_bets WHERE round_id=$1)::integer),true),'{totalBetAmount}',to_jsonb((SELECT COALESCE(sum(bet_amount),0)::text FROM public.authoritative_game_bets WHERE round_id=$1)),true) WHERE id=$1",
        [round.id],
      );
      return result;
    });
    return res.status(201).json({ success: true, betCount: placed.length, totalBet: rawBets.reduce((sum: number, bet: any) => sum + Number(bet.amount), 0).toString(), placedBets: placed, ...(await readGameState(code)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const known = ['GAME_NOT_CONFIGURED','BETTING_CLOSED','GAME_WALLETS_NOT_CONFIGURED','BET_OUT_OF_RANGE','GAME_POOL_INSUFFICIENT','IDEMPOTENCY_KEY_REUSE','PLAYER_WALLET_NOT_FOUND'];
    if (known.includes(message)) return res.status(message === 'GAME_NOT_CONFIGURED' || message === 'GAME_WALLETS_NOT_CONFIGURED' ? 503 : 400).json({ error: message });
    console.error('Authoritative game bet placement failed:', error);
    return res.status(400).json({ error: 'BET_PLACEMENT_FAILED' });
  }
}

authoritativeGamesRouter.post('/games/:gameCode/bet', auth, async (req: AuthRequest, res) => {
  const code = codeFromParam(req.params.gameCode);
  if (!code) return res.status(404).json({ error: 'UNKNOWN_GAME' });
  return placeBets(req, res, code);
});
for (const [path, code] of [
  ['/games/roulette/bet','roulette'],
  ['/games/roulette/spin','roulette'],
  ['/games/dice/bet','dice'],
  ['/games/dice/roll','dice'],
  ['/games/dragon-tiger/bet','dragon_tiger'],
  ['/games/andar-bahar/bet','andar_bahar'],
] as Array<[string, GameCode]>) {
  authoritativeGamesRouter.post(path, auth, (req: AuthRequest, res: Response) => placeBets(req, res, code));
}

async function settleRound(roundId: string, code: GameCode) {
  const sql = getDatabaseClient();
  await sql.begin(async (tx) => {
    const rows = await tx.unsafe('SELECT * FROM public.authoritative_game_rounds WHERE id=$1 FOR UPDATE', [roundId]);
    const round = rows[0];
    if (!round || !canSettleRound(round.status, round.result)) return;
    const gameRows = await tx.unsafe("SELECT pool_wallet_id FROM public.games WHERE code=$1 LIMIT 1", [code]);
    const poolWalletId = gameRows[0]?.pool_wallet_id;
    const escrowRows = await tx.unsafe("SELECT id FROM public.wallets WHERE wallet_type='ESCROW' ORDER BY id LIMIT 1");
    if (!poolWalletId || !escrowRows[0]) throw new Error('GAME_WALLETS_NOT_CONFIGURED');
    const bets = await tx.unsafe("SELECT * FROM public.authoritative_game_bets WHERE round_id=$1 AND status='PENDING' ORDER BY id FOR UPDATE", [roundId]);
    for (const bet of bets) {
      const playerRows = await tx.unsafe("SELECT id FROM public.wallets WHERE user_id=$1 AND wallet_type='PLAYER' LIMIT 1", [bet.user_id]);
      if (!playerRows[0]) throw new Error('PLAYER_WALLET_NOT_FOUND');
      await tx.unsafe("SELECT id FROM public.wallets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[poolWalletId, escrowRows[0].id, playerRows[0].id]]);
      const reservationRows = await tx.unsafe('UPDATE public.wallets SET reserved_balance=reserved_balance-$2::bigint,updated_at=now() WHERE id=$1 AND reserved_balance >= $2::bigint RETURNING id', [poolWalletId, String(bet.reserved_liability)]);
      if (!reservationRows[0]) throw new Error('GAME_POOL_RESERVATION_INVARIANT_FAILED');
      const multiplier = payoutMultiplier(code, bet.selection, round.result);
      const amount = BigInt(String(bet.bet_amount));
      const gross = multiplier > 0 ? amount * BigInt(multiplier) : 0n;
      const releaseRows = await tx.unsafe(
        "SELECT public.wallet_transfer_atomic($1,'BET_LOSS_GAME_POOL'::public.transaction_type_enum,$2,$3::uuid,$4::uuid,$5::jsonb) AS id",
        ['AGAME_STAKE_RELEASE_' + bet.id, amount.toString(), escrowRows[0].id, poolWalletId,
          JSON.stringify({ gameCode: code, roundId, betId: bet.id, settlement: 'stake_to_pool' })],
      );
      let payoutTxId: string | null = null;
      if (gross > 0n) {
        const payoutRows = await tx.unsafe(
          "SELECT public.wallet_transfer_atomic($1,'BET_WIN_PAYOUT'::public.transaction_type_enum,$2,$3::uuid,$4::uuid,$5::jsonb) AS id",
          ['AGAME_PAYOUT_' + bet.id, gross.toString(), poolWalletId, playerRows[0].id,
            JSON.stringify({ gameCode: code, roundId, betId: bet.id, multiplier })],
        );
        payoutTxId = payoutRows[0].id;
      }
      await tx.unsafe(
        "UPDATE public.authoritative_game_bets SET status=$1,payout_amount=$2,stake_release_transaction_id=$3,payout_transaction_id=$4,settled_at=now() WHERE id=$5",
        [gross > 0n ? 'WON' : 'LOST', gross.toString(), releaseRows[0].id, payoutTxId, bet.id],
      );
    }
    await tx.unsafe("UPDATE public.authoritative_game_rounds SET status='SETTLED',settled_at=now(),server_seed=server_seed WHERE id=$1", [roundId]);
  });
}

async function tick() {
  if (engineBusy) return;
  engineBusy = true;
  try {
    const sql = getDatabaseClient();
    if (!(await hasRuntimeSchema())) {
      if (Date.now() - lastSchemaWarningAt > 60000) {
        console.warn('Authoritative game runtime migration is not applied yet; game engine remains idle.');
        lastSchemaWarningAt = Date.now();
      }
      return;
    }
    const activeRows = await sql.unsafe(
      "SELECT g.code,g.status FROM public.games g WHERE g.code = ANY($1::text[]) AND (g.status='ACTIVE' OR EXISTS (SELECT 1 FROM public.authoritative_game_rounds r WHERE r.game_code=g.code AND r.status IN ('BETTING','RUNNING','RESULT')))", [GAME_CODES],
    );
    for (const game of activeRows) {
      const code = game.code as GameCode;
      const latestRows = await sql.unsafe('SELECT * FROM public.authoritative_game_rounds WHERE game_code=$1 ORDER BY round_number DESC LIMIT 1', [code]);
      const latest = latestRows[0];
      if (latest?.status === 'BETTING' && new Date(latest.betting_closes_at).getTime() <= Date.now()) {
        const seed = String(latest.server_seed || '');
        const result = makeResult(code, seed);
        await sql.unsafe("UPDATE public.authoritative_game_rounds SET status='RUNNING',result=$2::jsonb WHERE id=$1 AND status='BETTING'", [latest.id, JSON.stringify(result)]);
      } else if (latest?.status === 'RUNNING' && Date.now() - new Date(latest.betting_closes_at).getTime() >= 1500) {
        if (!latest.result) {
          const recoveredResult = makeResult(code, String(latest.server_seed || ''));
          await sql.unsafe("UPDATE public.authoritative_game_rounds SET result=$2::jsonb WHERE id=$1 AND status='RUNNING' AND result IS NULL", [latest.id, JSON.stringify(recoveredResult)]);
        }
        await sql.unsafe("UPDATE public.authoritative_game_rounds SET status='RESULT' WHERE id=$1 AND status='RUNNING' AND result IS NOT NULL", [latest.id]);
      } else if (latest?.status === 'RESULT' && Date.now() - new Date(latest.betting_closes_at).getTime() >= 2700) {
        await settleRound(latest.id, code);
      } else if (game.status === 'ACTIVE' && (!latest || latest.status === 'SETTLED' || latest.status === 'CANCELLED') &&
          (!latest || !latest.settled_at || Date.now() - new Date(latest.settled_at).getTime() >= 2500)) {
        const gameRows = await sql.unsafe("SELECT COALESCE(MAX(round_number),0)::bigint AS n FROM public.authoritative_game_rounds WHERE game_code=$1", [code]);
        const roundNumber = Number(gameRows[0].n) + 1;
        const seed = randomBytes(32).toString('hex');
        const seedHash = createHash('sha256').update(seed).digest('hex');
        await sql.unsafe(
          "INSERT INTO public.authoritative_game_rounds(game_code,round_number,status,state,server_seed_hash,server_seed,opened_at,betting_closes_at) VALUES($1,$2,'BETTING',$3::jsonb,$4,$5,now(),now()+($6::text||' milliseconds')::interval)",
          [code, roundNumber, JSON.stringify({ totalBetsCount: 0, totalBetAmount: '0' }), seedHash, seed, BETTING_MS],
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('GAME_WALLETS_NOT_CONFIGURED')) console.error('Authoritative game engine tick failed:', message);
  } finally {
    engineBusy = false;
  }
}

export function startAuthoritativeGameEngine() {
  if (engineTimer) return;
  engineTimer = setInterval(() => { void tick(); }, 500);
  void tick();
  console.log('Persistent authoritative game engine supervisor started.');
}
export function stopAuthoritativeGameEngine() {
  if (engineTimer) clearInterval(engineTimer);
  engineTimer = null;
}
