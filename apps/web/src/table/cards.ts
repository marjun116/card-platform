/**
 * Card names, labels and pictures. (Written here rather than imported from
 * the engine, so the engine's schema code stays out of the browser bundle.)
 */
import type { Card, Suit } from '@card-table/engine';

export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

export const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

const RANK_NAME: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
const SUIT_LETTER: Record<Suit, string> = { clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' };

export function isJoker(card: Card): card is Extract<Card, { joker: true }> {
  return 'joker' in card;
}

/** Short label for text: "Q♠", "10♥", "Joker". */
export function shortLabel(card: Card): string {
  return isJoker(card) ? 'Joker' : `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

/** Spoken label: "Queen of spades", "10 of hearts", "Joker". */
export function spokenLabel(card: Card): string {
  return isJoker(card) ? 'Joker' : `${RANK_NAME[card.rank] ?? card.rank} of ${card.suit}`;
}

export function suitName(suit: Suit): string {
  return suit[0]?.toUpperCase() + suit.slice(1);
}

/**
 * Picture of a card face, or null for jokers (drawn by the Card component).
 * Four-colour versions exist for clubs and diamonds number cards.
 */
export function cardImage(card: Card, fourColor: boolean): string | null {
  if (isJoker(card)) return null;
  const name = `${card.rank}${SUIT_LETTER[card.suit]}.svg`;
  const recoloured =
    fourColor &&
    (card.suit === 'clubs' || card.suit === 'diamonds') &&
    !['J', 'Q', 'K'].includes(card.rank);
  return recoloured ? `/cards/four-color/${name}` : `/cards/${name}`;
}

/** CSS class giving a suit its colour (see styles.css): four colours, or red and black. */
export function suitClass(suit: Suit | null, fourColor: boolean): string {
  if (suit === null) return 'suit-joker';
  if (fourColor) return `suit-${suit}`;
  return suit === 'hearts' || suit === 'diamonds' ? 'suit-hearts' : 'suit-spades';
}

const LETTER_SUIT: Record<string, Suit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

/** The card a card id names: "QH.0" is the queen of hearts, "JOKER.1" a joker. */
export function cardFromId(id: string): Card | null {
  const face = id.split('.')[0] ?? '';
  if (face === 'JOKER') return { id, joker: true };
  const suit = LETTER_SUIT[face.slice(-1)];
  const rank = face.slice(0, -1);
  if (!suit || !/^(?:[2-9]|10|[JQKA])$/.test(rank)) return null;
  return { id, suit, rank: rank as Extract<Card, { suit: Suit }>['rank'] };
}

const SUIT_ORDER = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 } as const;
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Suits grouped, alternating colours, low to high. A display choice only. */
export function sortHand(cards: readonly Card[]): Card[] {
  const key = (card: Card) =>
    isJoker(card) ? 100 : SUIT_ORDER[card.suit] * 20 + RANK_ORDER.indexOf(card.rank);
  return [...cards].sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}
