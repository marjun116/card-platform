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

/** Picture of a card face, or null for jokers (drawn by the Card component). */
export function cardImage(card: Card): string | null {
  if (isJoker(card)) return null;
  return `/cards/${card.rank}${SUIT_LETTER[card.suit]}.svg`;
}

/** Hearts and diamonds are red; spades, clubs and jokers black. */
export function isRed(suit: Suit | null): boolean {
  return suit === 'hearts' || suit === 'diamonds';
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

const USUAL_SUIT_ORDER: Record<Suit, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const RED: readonly Suit[] = ['hearts', 'diamonds'];

/**
 * Suits grouped, alternating colours, low to high. A display choice only.
 * With bowers (euchre), both jacks of trump's colour sit at the top of trump:
 * the left bower, then the right bower. A game can set its own suit order
 * (`view.sortSuits`, e.g. hearts last); suits it leaves out follow in the usual order.
 */
export function sortHand(
  cards: readonly Card[],
  trump: { suit: Suit; bowers: boolean } | null = null,
  suits: readonly Suit[] | null = null,
): Card[] {
  const SUIT_ORDER: Record<Suit, number> = { ...USUAL_SUIT_ORDER };
  if (suits) {
    for (const suit of Object.keys(SUIT_ORDER) as Suit[]) {
      const at = suits.indexOf(suit);
      SUIT_ORDER[suit] = at === -1 ? suits.length + USUAL_SUIT_ORDER[suit] : at;
    }
  }
  const key = (card: Card) => {
    if (isJoker(card)) return 100;
    if (
      trump?.bowers &&
      card.rank === 'J' &&
      RED.includes(card.suit) === RED.includes(trump.suit)
    ) {
      const right = card.suit === trump.suit;
      return SUIT_ORDER[trump.suit] * 20 + RANK_ORDER.length + (right ? 1 : 0);
    }
    return SUIT_ORDER[card.suit] * 20 + RANK_ORDER.indexOf(card.rank);
  };
  return [...cards].sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}

/** Whether a card is trump: its suit, or with bowers the other jack of trump's colour. */
export function isTrump(card: Card, trump: { suit: Suit; bowers: boolean } | null): boolean {
  if (!trump || isJoker(card)) return false;
  if (card.suit === trump.suit) return true;
  return trump.bowers && card.rank === 'J' && isRed(card.suit) === isRed(trump.suit);
}
