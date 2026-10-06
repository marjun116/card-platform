import { type Card, cardSuit, isJoker, RANKS, type Rank, type Suit } from './card';

export type TrickRule = 'highestLed' | 'highestTrumpElseHighestLed';

/** Position of the card's rank in the game's order (higher beats lower); -1 for jokers. */
export function rankIndex(ranks: readonly Rank[], card: Card): number {
  return isJoker(card) ? -1 : ranks.indexOf(card.rank);
}

/** Suit of the first suited card played; null if none (all jokers). */
export function ledSuit(cards: readonly Card[]): Suit | null {
  for (const card of cards) {
    const suit = cardSuit(card);
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
): number {
  const led = ledSuit(cards);
  const winningSuit =
    rule === 'highestTrumpElseHighestLed' && trump && cards.some((c) => cardSuit(c) === trump)
      ? trump
      : led;

  let best = 0;
  let bestRank = -2;
  cards.forEach((card, i) => {
    if (cardSuit(card) !== winningSuit) return;
    const r = rankIndex(ranks, card);
    if (r > bestRank) {
      best = i;
      bestRank = r;
    }
  });
  return best;
}
