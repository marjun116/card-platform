/**
 * Counting patterns in a group of cards: groups adding up to a total, pairs
 * and runs. Used by expression functions such as countSums(15, hand, starter)
 * and pile properties such as pile.runAtEnd.
 */
import { type Card, cardRank, isJoker, type Rank } from './card';
import { rankIndex } from './order';

/** How many different groups of cards (by position, at least one card) add up to `total`. */
export function countSums(values: readonly number[], total: number): number {
  if (!Number.isInteger(total) || total < 1) return 0;
  // ways[t]: groups from the cards so far adding up to t.
  const ways = Array.from({ length: total + 1 }, (_, t): number => (t === 0 ? 1 : 0));
  for (const value of values) {
    if (!Number.isInteger(value) || value < 1) continue;
    for (let t = total; t >= value; t--) ways[t] = (ways[t] ?? 0) + (ways[t - value] ?? 0);
  }
  return ways[total] ?? 0;
}

/** How many pairs of cards share a rank (three of a kind is 3 pairs). Jokers never pair. */
export function countPairs(cards: readonly Card[]): number {
  const counts = new Map<Rank | 'JOKER', number>();
  for (const card of cards) {
    if (!isJoker(card)) counts.set(cardRank(card), (counts.get(cardRank(card)) ?? 0) + 1);
  }
  let pairs = 0;
  for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  return pairs;
}

/**
 * Cards in runs of 3 or more consecutive ranks (in the game's rank order),
 * counting each longest run once for every different set of cards that makes
 * it: 3-4-5-6 gives 4, 3-3-4-5 gives 6 (two runs of 3), 3-3-4-4-5 gives 12.
 * Runs don't go round the corner. Jokers are left out.
 */
export function runCards(cards: readonly Card[], ranks: readonly Rank[]): number {
  const counts = ranks.map(() => 0);
  for (const card of cards) {
    const i = rankIndex(ranks, card);
    if (i >= 0) counts[i] = (counts[i] ?? 0) + 1;
  }
  let total = 0;
  let length = 0;
  let ways = 1;
  for (const n of [...counts, 0]) {
    if (n > 0) {
      length++;
      ways *= n;
      continue;
    }
    if (length >= 3) total += length * ways;
    length = 0;
    ways = 1;
  }
  return total;
}

/** How many cards at the top of the pile (the end of the list) share the top card's rank. */
export function sameRankAtEnd(cards: readonly Card[]): number {
  const top = cards[cards.length - 1];
  if (!top || isJoker(top)) return 0;
  let n = 0;
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i] as Card;
    if (isJoker(card) || cardRank(card) !== cardRank(top)) break;
    n++;
  }
  return n;
}

/**
 * The most cards at the top of the pile that form a run of 3 or more in any
 * order (each rank once, consecutive in the game's rank order), or 0.
 */
export function runAtEnd(cards: readonly Card[], ranks: readonly Rank[]): number {
  for (let k = cards.length; k >= 3; k--) {
    const indexes = cards.slice(-k).map((c) => rankIndex(ranks, c));
    if (indexes.some((i) => i < 0)) continue;
    const distinct = new Set(indexes);
    if (distinct.size === k && Math.max(...indexes) - Math.min(...indexes) === k - 1) return k;
  }
  return 0;
}
