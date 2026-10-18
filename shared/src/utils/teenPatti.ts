export type CardSuit = 'S' | 'H' | 'D' | 'C';

export interface Card {
  suit: CardSuit;
  rank: number; // 2 - 14 (14 is Ace)
}

export enum TeenPattiHandType {
  TRAIL = 'TRAIL', // Trio / 3 of a kind
  PURE_SEQUENCE = 'PURE_SEQUENCE', // Straight Flush
  SEQUENCE = 'SEQUENCE', // Straight / Run
  COLOR = 'COLOR', // Flush
  PAIR = 'PAIR', // Pair
  HIGH_CARD = 'HIGH_CARD',
}

export interface HandEvaluation {
  type: TeenPattiHandType;
  name: string;
  score: number;
  description: string;
  highlightCardRanks: number[];
}

export const SUIT_SYMBOLS: Record<CardSuit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export const SUIT_COLORS: Record<CardSuit, 'red' | 'black'> = {
  S: 'black',
  H: 'red',
  D: 'red',
  C: 'black',
};

export function getRankLabel(rank: number): string {
  switch (rank) {
    case 14:
      return 'A';
    case 13:
      return 'K';
    case 12:
      return 'Q';
    case 11:
      return 'J';
    case 10:
      return '10';
    default:
      return rank.toString();
  }
}

export function formatCard(card: Card): string {
  return `${getRankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

export function createDeck(): Card[] {
  const suits: CardSuit[] = ['S', 'H', 'D', 'C'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Evaluates a 3-card hand according to official Teen Patti rules
 */
export function evaluateTeenPattiHand(cards: Card[]): HandEvaluation {
  if (cards.length !== 3) {
    return {
      type: TeenPattiHandType.HIGH_CARD,
      name: 'High Card',
      score: 0,
      description: 'Incomplete hand',
      highlightCardRanks: [],
    };
  }

  // Sort ranks descending
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const r0 = sorted[0].rank;
  const r1 = sorted[1].rank;
  const r2 = sorted[2].rank;

  const isFlush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;

  // Straight check:
  // Standard sequences:
  // A-K-Q (14, 13, 12) -> highest
  // A-2-3 (14, 3, 2) -> 2nd highest in standard Teen Patti
  // K-Q-J down to 4-3-2
  let isStraight = false;
  let straightRankScore = 0;

  if (r0 === 14 && r1 === 13 && r2 === 12) {
    isStraight = true;
    straightRankScore = 14; // AKQ highest
  } else if (r0 === 14 && r1 === 3 && r2 === 2) {
    isStraight = true;
    straightRankScore = 13.5; // A23 second highest in Indian Teen Patti rules
  } else if (r0 - r1 === 1 && r1 - r2 === 1) {
    isStraight = true;
    straightRankScore = r0;
  }

  // 1. Trail / Trio / Set (AAA, KKK, etc.)
  if (r0 === r1 && r1 === r2) {
    return {
      type: TeenPattiHandType.TRAIL,
      name: 'Trail (Trio)',
      score: 600000 + r0,
      description: `Trail of ${getRankLabel(r0)}'s`,
      highlightCardRanks: [r0],
    };
  }

  // 2. Pure Sequence (Straight Flush)
  if (isStraight && isFlush) {
    return {
      type: TeenPattiHandType.PURE_SEQUENCE,
      name: 'Pure Sequence',
      score: 500000 + straightRankScore * 100,
      description: `Pure Sequence (${getRankLabel(r0)}-${getRankLabel(r1)}-${getRankLabel(r2)})`,
      highlightCardRanks: [r0, r1, r2],
    };
  }

  // 3. Sequence (Normal Run)
  if (isStraight) {
    return {
      type: TeenPattiHandType.SEQUENCE,
      name: 'Sequence (Run)',
      score: 400000 + straightRankScore * 100,
      description: `Sequence (${getRankLabel(r0)}-${getRankLabel(r1)}-${getRankLabel(r2)})`,
      highlightCardRanks: [r0, r1, r2],
    };
  }

  // 4. Color / Flush
  if (isFlush) {
    return {
      type: TeenPattiHandType.COLOR,
      name: 'Color (Flush)',
      score: 300000 + r0 * 400 + r1 * 20 + r2,
      description: `Flush ${getRankLabel(r0)} High (${SUIT_SYMBOLS[cards[0].suit]})`,
      highlightCardRanks: [r0],
    };
  }

  // 5. Pair (Double)
  if (r0 === r1 || r1 === r2 || r0 === r2) {
    const pairRank = r0 === r1 ? r0 : r2 === r1 ? r1 : r0;
    const kicker = r0 === r1 ? r2 : r1 === r2 ? r0 : r1;
    return {
      type: TeenPattiHandType.PAIR,
      name: 'Pair',
      score: 200000 + pairRank * 100 + kicker,
      description: `Pair of ${getRankLabel(pairRank)}'s (${getRankLabel(kicker)} Kicker)`,
      highlightCardRanks: [pairRank],
    };
  }

  // 6. High Card
  return {
    type: TeenPattiHandType.HIGH_CARD,
    name: 'High Card',
    score: 100000 + r0 * 400 + r1 * 20 + r2,
    description: `High Card ${getRankLabel(r0)}`,
    highlightCardRanks: [r0],
  };
}

export function compareHands(handA: Card[], handB: Card[]): number {
  const evalA = evaluateTeenPattiHand(handA);
  const evalB = evaluateTeenPattiHand(handB);
  return evalA.score - evalB.score;
}
