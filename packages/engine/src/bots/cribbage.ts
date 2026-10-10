/**
 * Rule-of-thumb play for counting games like cribbage: keep the four cards
 * that score best as a hand, and peg as many points as possible (fifteens,
 * 31, pairs, runs), not leaving a count the next player can easily score on.
 */
import { type Card, RANKS } from '../cards/card';
import { countPairs, countSums, runAtEnd, runCards, sameRankAtEnd } from '../cards/patterns';
import { combinations } from '../actions/common';
import type { GameFile } from '../game/types';
import type { Move } from '../game/move';
import type { PlayerView } from '../view';
import { cardPoints, handOf } from './table';
import type { BotPart } from './types';

export interface CountingGoals {
  /** Cards kept for the hand (cribbage: 4; a house rule may change it). */
  keep: (view: PlayerView) => number;
  /** The shared pile cards are played into, and the `state` value holding its count. */
  pile: string;
  count: string;
}

/** What a hand of these cards scores on its own: fifteens, pairs, runs, a flush. */
export function handScore(file: GameFile, cards: readonly Card[]): number {
  const ranks = file.cardOrder?.ranks ?? RANKS;
  const values = cards.map((c) => cardPoints(file, c));
  const suits = new Set(cards.map((c) => ('suit' in c ? c.suit : null)));
  const flush = cards.length >= 4 && suits.size === 1 ? cards.length : 0;
  return countSums(values, 15) * 2 + countPairs(cards) * 2 + runCards(cards, ranks) + flush;
}

export function countingPlay(goals: CountingGoals): BotPart {
  return (input) => {
    const { legal, view, file } = input;
    const hand = handOf(view, view.you);
    const cardOf = (move: Move) =>
      'card' in move && move.card ? hand.find((c) => c.id === move.card) : undefined;

    // Throwing cards out (to the crib): keep the best-scoring cards.
    const discards = legal.filter((m) => m.type === 'discard');
    const keepCount = goals.keep(view);
    if (discards.length > 0 && hand.length > keepCount) {
      let best: readonly Card[] = [];
      let bestScore = -1;
      for (const keep of combinations(hand, keepCount)) {
        const score = handScore(file, keep);
        if (score > bestScore) {
          best = keep;
          bestScore = score;
        }
      }
      const kept = new Set(best.map((c) => c.id));
      return discards.find((m) => !kept.has(cardOf(m)?.id ?? '')) ?? discards[0] ?? null;
    }

    // Pegging: the most points now, then a safe count, then the highest card.
    const plays = legal.filter((m) => m.type === 'play');
    if (plays.length === 0) return null;
    const pile = view.zones[goals.pile];
    const played = pile?.kind === 'cards' ? pile.cards : [];
    const total =
      typeof view.vars[goals.count] === 'number' ? (view.vars[goals.count] as number) : 0;
    // The cards played since the count last started again.
    const sequence: Card[] = [];
    let sum = 0;
    for (let i = played.length - 1; i >= 0 && sum < total; i--) {
      const card = played[i] as Card;
      sequence.unshift(card);
      sum += cardPoints(file, card);
    }
    const ranks = file.cardOrder?.ranks ?? RANKS;
    const score = (m: Move) => {
      const card = cardOf(m);
      if (!card) return -Infinity;
      const count = total + cardPoints(file, card);
      const after = [...sequence, card];
      const pairs = sameRankAtEnd(after);
      let points = (count === 15 ? 2 : 0) + (count === 31 ? 2 : 0);
      points += pairs >= 2 ? pairs * (pairs - 1) : 0;
      points += runAtEnd(after, ranks);
      // Counts the next player can make 15 or 31 from with one card.
      const risky = count === 5 || count === 21 ? 0.5 : 0;
      return points * 100 - risky * 100 + cardPoints(file, card);
    };
    return plays.reduce((a, b) => (score(b) > score(a) ? b : a));
  };
}
