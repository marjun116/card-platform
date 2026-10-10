/**
 * Rule-of-thumb play for shedding games (crazy eights): play rather than
 * draw, get rid of costly cards first, keep wild cards for when nothing else
 * plays, and name the suit the bot holds most of.
 */
import { type Card, isJoker, type Suit } from '../cards/card';
import type { Move } from '../game/move';
import { cardPoints, handOf } from './table';
import type { BotPart } from './types';

export interface SheddingGoals {
  /** Wild cards, kept back while another card can be played. */
  wild: (card: Card) => boolean;
}

export function sheddingPlay(goals: SheddingGoals): BotPart {
  return (input) => {
    const { legal, view, file } = input;
    const hand = handOf(view, view.you);
    const cardOf = (move: Move) =>
      'card' in move && move.card ? hand.find((c) => c.id === move.card) : undefined;

    // Naming a suit (after a wild card): the one held most of, wild cards aside.
    const suits = legal.filter((m) => m.type === 'chooseSuit');
    if (suits.length > 0) {
      const count = (suit: Suit) =>
        hand.filter((c) => !isJoker(c) && c.suit === suit && !goals.wild(c)).length;
      return suits.reduce((a, b) =>
        a.type === 'chooseSuit' && b.type === 'chooseSuit' && count(b.suit) > count(a.suit) ? b : a,
      );
    }

    const plays = legal.filter((m) => m.type === 'play');
    if (plays.length > 0) {
      const plain = plays.filter((m) => {
        const card = cardOf(m);
        return card !== undefined && !goals.wild(card);
      });
      const pool = plain.length > 0 ? plain : plays;
      // The costliest card, then the suit with most cards left (to keep playing it).
      const held = (card: Card | undefined) =>
        card && !isJoker(card) ? hand.filter((c) => !isJoker(c) && c.suit === card.suit).length : 0;
      const score = (m: Move) => {
        const card = cardOf(m);
        return card ? cardPoints(file, card) * 100 + held(card) : -1;
      };
      return pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    }

    // Nothing to play: draw.
    return legal.find((m) => m.type === 'draw') ?? null;
  };
}
