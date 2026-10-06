import { type Card, cardRank, cardSuit, isJoker, RANKS, type Rank } from '../cards/card';
import { rankIndex } from '../cards/order';
import { combinations } from './common';

export type MeldKind = 'set' | 'run';

/** Largest same-rank group we enumerate subsets of (keeps multi-deck games fast). */
const MAX_SET_GROUP = 8;

/** Is this group a set (same rank) or a run (same suit, consecutive ranks)? */
export function meldKind(cards: readonly Card[], ranks: readonly Rank[] = RANKS): MeldKind | null {
  if (cards.length === 0 || cards.some(isJoker)) return null;
  const first = cards[0] as Card;
  if (cards.every((c) => cardRank(c) === cardRank(first))) return 'set';
  if (!cards.every((c) => cardSuit(c) === cardSuit(first))) return null;
  const positions = cards.map((c) => rankIndex(ranks, c)).sort((a, b) => a - b);
  if (positions[0] === -1) return null;
  return positions.every((p, i) => i === 0 || p === (positions[i - 1] as number) + 1)
    ? 'run'
    : null;
}

/** Every meld that can be made from these cards. */
export function findMelds(
  cards: readonly Card[],
  kinds: readonly MeldKind[],
  minSize: number,
  ranks: readonly Rank[] = RANKS,
): Card[][] {
  const melds: Card[][] = [];
  const suited = cards.filter((c) => !isJoker(c));

  if (kinds.includes('set')) {
    const byRank = groupBy(suited, (c) => cardRank(c));
    for (const group of byRank.values()) {
      if (group.length < minSize) continue;
      if (group.length > MAX_SET_GROUP) {
        melds.push(group);
        continue;
      }
      for (let size = minSize; size <= group.length; size++) {
        melds.push(...combinations(group, size));
      }
    }
  }

  if (kinds.includes('run')) {
    const bySuit = groupBy(suited, (c) => cardSuit(c) ?? '');
    for (const group of bySuit.values()) {
      // One card per rank is enough: duplicate copies make identical runs.
      const byPosition = new Map<number, Card>();
      for (const card of group) {
        const p = rankIndex(ranks, card);
        if (p >= 0 && !byPosition.has(p)) byPosition.set(p, card);
      }
      const positions = [...byPosition.keys()].sort((a, b) => a - b);
      for (let start = 0; start < positions.length; start++) {
        let end = start;
        while (
          end + 1 < positions.length &&
          positions[end + 1] === (positions[end] as number) + 1
        ) {
          end++;
          const length = end - start + 1;
          if (length >= minSize) {
            melds.push(positions.slice(start, end + 1).map((p) => byPosition.get(p) as Card));
          }
        }
        if (minSize <= 1) melds.push([byPosition.get(positions[start] as number) as Card]);
      }
    }
  }
  return melds;
}

/** Can this card be added to an existing meld? */
export function canLayOff(
  meld: readonly Card[],
  card: Card,
  ranks: readonly Rank[] = RANKS,
): boolean {
  const kind = meldKind(meld, ranks);
  if (kind === null || isJoker(card)) return false;
  if (kind === 'set') return cardRank(card) === cardRank(meld[0] as Card);
  return meldKind([...meld, card], ranks) === 'run';
}

/** Sorts a meld into rank order (runs read naturally). */
export function sortMeld(meld: Card[], ranks: readonly Rank[] = RANKS): void {
  meld.sort((a, b) => rankIndex(ranks, a) - rankIndex(ranks, b));
}

function groupBy<K>(cards: readonly Card[], key: (card: Card) => K): Map<K, Card[]> {
  const groups = new Map<K, Card[]>();
  for (const card of cards) {
    const k = key(card);
    const group = groups.get(k);
    if (group) group.push(card);
    else groups.set(k, [card]);
  }
  return groups;
}
