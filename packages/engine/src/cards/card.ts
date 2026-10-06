export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

/**
 * Unique within a game: rank, suit letter and which deck copy it came from,
 * e.g. "QH.0" or "10S.1". Jokers are "JOKER.0", "JOKER.1", …
 */
export type CardId = string;

export interface SuitedCard {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface JokerCard {
  readonly id: CardId;
  readonly joker: true;
}

export type Card = SuitedCard | JokerCard;

const SUIT_LETTER: Record<Suit, string> = { clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' };

export function isJoker(card: Card): card is JokerCard {
  return 'joker' in card;
}

export function isSuit(value: unknown): value is Suit {
  return typeof value === 'string' && (SUITS as readonly string[]).includes(value);
}

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

export function suitedCard(rank: Rank, suit: Suit, copy = 0): SuitedCard {
  return { id: `${rank}${SUIT_LETTER[suit]}.${copy}`, suit, rank };
}

export function jokerCard(n: number): JokerCard {
  return { id: `JOKER.${n}`, joker: true };
}

export function cardSuit(card: Card): Suit | null {
  return isJoker(card) ? null : card.suit;
}

export function cardRank(card: Card): Rank | 'JOKER' {
  return isJoker(card) ? 'JOKER' : card.rank;
}

/** Short human-readable label, e.g. "Q♥" or "Joker". */
export function cardLabel(card: Card): string {
  if (isJoker(card)) return 'Joker';
  const symbol = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[card.suit];
  return `${card.rank}${symbol}`;
}
