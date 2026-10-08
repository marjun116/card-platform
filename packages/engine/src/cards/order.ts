import { type Card, cardSuit, isJoker, RANKS, type Rank, type Suit } from './card';

export type TrickRule = 'highestLed' | 'highestTrumpElseHighestLed';

/** Position of the card's rank in the game's order (higher beats lower); -1 for jokers. */
export function rankIndex(ranks: readonly Rank[], card: Card): number {
  return isJoker(card) ? -1 : ranks.indexOf(card.rank);
}

const RED: readonly Suit[] = ['hearts', 'diamonds'];
const sameColour = (a: Suit, b: Suit) => RED.includes(a) === RED.includes(b);

/** Is this the left bower: the jack of the other suit of trump's colour? */
function isLeftBower(card: Card, trump: Suit): boolean {
  return !isJoker(card) && card.rank === 'J' && card.suit !== trump && sameColour(card.suit, trump);
}

/**
 * The suit a card counts as. With bowers, the left bower (the other jack of
 * trump's colour) counts as trump; otherwise it's the suit printed on it.
 */
export function effectiveSuit(card: Card, trump: Suit | null, bowers: boolean): Suit | null {
  if (bowers && trump && isLeftBower(card, trump)) return trump;
  return cardSuit(card);
}

/** Suit of the first suited card played; null if none (all jokers). */
export function ledSuit(
  cards: readonly Card[],
  suitOf: (card: Card) => Suit | null = cardSuit,
): Suit | null {
  for (const card of cards) {
    const suit = suitOf(card);
    if (suit) return suit;
  }
  return null;
}

/**
 * Index (into `cards`, in play order) of the card that wins the trick.
 * Jokers never win a trick. If two identical cards are played (multi-deck
 * games), the first one played wins.
 */
export function trickWinnerIndex(
  cards: readonly Card[],
  rule: TrickRule,
  trump: Suit | null,
  ranks: readonly Rank[] = RANKS,
  bowers = false,
): number {
  const suitOf = (card: Card) => effectiveSuit(card, trump, bowers);
  const led = ledSuit(cards, suitOf);
  const winningSuit =
    rule === 'highestTrumpElseHighestLed' && trump && cards.some((c) => suitOf(c) === trump)
      ? trump
      : led;
  // With bowers, the jack of trump beats everything, then the left bower.
  const power = (card: Card) => {
    if (bowers && trump && !isJoker(card) && card.rank === 'J' && suitOf(card) === trump) {
      return ranks.length + (card.suit === trump ? 1 : 0);
    }
    return rankIndex(ranks, card);
  };

  let best = 0;
  let bestRank = -2;
  cards.forEach((card, i) => {
    if (suitOf(card) !== winningSuit) return;
    const r = power(card);
    if (r > bestRank) {
      best = i;
      bestRank = r;
    }
  });
  return best;
}
