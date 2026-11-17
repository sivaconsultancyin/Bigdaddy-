export type CardSuit = 'S' | 'H' | 'D' | 'C';

export interface Card {
  suit: CardSuit;
  rank: number;
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
    case 14: return 'A';
    case 13: return 'K';
    case 12: return 'Q';
    case 11: return 'J';
    case 10: return '10';
    default: return rank.toString();
  }
}

export function formatCard(card: Card): string {
  return `${getRankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

export function createDeck(): Card[] {
  const suits: CardSuit[] = ['S', 'H', 'D', 'C'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ suit, rank });
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
