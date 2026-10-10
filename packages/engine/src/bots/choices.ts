/** Small decisions many games share: named choices, bids near a target, cards to let go. */
import type { Card } from '../cards/card';
import type { Move } from '../game/move';
import { handOf, power, suitOf, trickRules } from './table';
import type { BotInput, BotPart } from './types';

/** The first of these `choose` values that's legal (in the order given). */
export function choose(...values: string[]): BotPart {
  return ({ legal }) => {
    for (const value of values) {
      const move = legal.find((m) => m.type === 'choose' && m.value === value);
      if (move) return move;
    }
    return null;
  };
}

/** The legal numeric bid nearest to `target` (the lower one on a tie). */
export function bidNearest(input: BotInput, target: number): Move | null {
  let best: Move | null = null;
  let distance = Infinity;
  for (const move of input.legal) {
    if (move.type !== 'bid' || typeof move.value !== 'number') continue;
    const d = Math.abs(move.value - target);
    // Bids are offered lowest first, so a tie keeps the lower one.
    if (d < distance) {
      best = move;
      distance = d;
    }
  }
  return best;
}

/** The lowest legal numeric bid, if any. */
export function lowestBid(input: BotInput): Move | null {
  const bids = input.legal.filter((m) => m.type === 'bid' && typeof m.value === 'number');
  if (bids.length === 0) return null;
  return bids.reduce((a, b) =>
    a.type === 'bid' && b.type === 'bid' && Number(b.value) < Number(a.value) ? b : a,
  );
}

/** How much a bot wants to keep a card: trumps and high cards most. */
function keepScore(input: BotInput, card: Card): number {
  return power(trickRules(input.file, input.view), card);
}

/** Discards the card it least wants to keep (a low card of a plain suit). */
export const discardLowest: BotPart = (input) => {
  const discards = input.legal.filter((m) => m.type === 'discard');
  if (discards.length === 0) return null;
  const hand = handOf(input.view, input.view.you);
  const score = (m: Move) => {
    const card = 'card' in m ? hand.find((c) => c.id === m.card) : undefined;
    return card ? keepScore(input, card) : Infinity;
  };
  return discards.reduce((a, b) => (score(b) < score(a) ? b : a));
};

/** Passes the cards it least wants to keep (pinochle's bidder passing back to a partner). */
export const passLow: BotPart = (input) => {
  const passes = input.legal.filter((m) => m.type === 'pass');
  if (passes.length === 0) return null;
  const rules = trickRules(input.file, input.view);
  const hand = handOf(input.view, input.view.you);
  const total = (m: Move) =>
    m.type === 'pass'
      ? m.cards.reduce((sum, id) => {
          const card = hand.find((c) => c.id === id);
          // Trumps are the last thing to give away.
          const trump = card && suitOf(rules, card) === rules.trump ? 100 : 0;
          return sum + (card ? power(rules, card) + trump : 0);
        }, 0)
      : Infinity;
  return passes.reduce((a, b) => (total(b) < total(a) ? b : a));
};
