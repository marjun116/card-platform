/**
 * Rule-of-thumb play for games where players arrange their hands into melds
 * (rummy, gin, canasta): keep the hand sorted into melds, meld and go out
 * whenever possible, take a discard that fits, and throw away the loose card
 * that costs the most.
 */
import { type Card, isJoker } from '../cards/card';
import type { Move } from '../game/move';
import type { PlayerView } from '../view';
import { cardPoints, handOf } from './table';
import type { BotInput, BotPart } from './types';

export interface MeldGoals {
  /** Cards never thrown away while there's another choice (canasta's wild cards). */
  keep?: (card: Card) => boolean;
  /** Always take the discard pile when allowed (canasta: it's how hands grow). */
  takePile?: boolean;
}

/** Group lists compared regardless of order. */
const sameGroups = (a: readonly string[][], b: readonly string[][]) => {
  const key = (groups: readonly string[][]) =>
    groups
      .map((g) => [...g].sort().join(','))
      .sort()
      .join(';');
  return key(a) === key(b);
};

/** The bot's current groups, as card ids. */
const currentGroups = (view: PlayerView) => view.arrangement?.groups.map((g) => g.cards) ?? [];

/**
 * Would this card complete a meld with cards already held: a set of three, or
 * a run of three in its suit? (Taking a card that only "goes with" the hand
 * leads to two bots passing the same card back and forth for ever.)
 */
function completesMeld(hand: readonly Card[], card: Card): boolean {
  if (isJoker(card)) return true;
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  if (hand.filter((c) => !isJoker(c) && c.rank === card.rank).length >= 2) return true;
  const at = order.indexOf(card.rank);
  const has = (offset: number) =>
    hand.some((c) => !isJoker(c) && c.suit === card.suit && order.indexOf(c.rank) === at + offset);
  return (has(-2) && has(-1)) || (has(-1) && has(1)) || (has(1) && has(2));
}

/** Plays a turn in a melding game. */
export function meldingPlay(goals: MeldGoals = {}): BotPart {
  return (input) => {
    const { legal, view } = input;
    const of = (type: Move['type']) => legal.filter((m) => m.type === type);
    const pick = (moves: readonly Move[]) => moves[input.random(moves.length)] ?? null;

    // Going out beats everything.
    const out = of('showHand');
    if (out.length > 0) return pick(out);
    const finish = chooseValue(legal, ['bigGin', 'gin', 'knock']);
    if (finish) return finish;

    // Before drawing: take the pile (canasta), or the discard if it completes a meld.
    const piles = of('pickUpPile');
    if (piles.length > 0 && goals.takePile) return pick(piles);
    const draws = of('draw');
    if (draws.length > 0) {
      const hand = handOf(view, view.you);
      const discard = view.zones.discard;
      const top = discard?.kind === 'count' ? discard.top : null;
      const fromDiscard = draws.find((m) => m.type === 'draw' && m.from === 'discard');
      if (fromDiscard && top && completesMeld(hand, top)) return fromDiscard;
      // Gin's upcard: pass on it unless it completes a meld.
      const passUp = chooseValue(legal, ['pass']);
      if (passUp && fromDiscard) return passUp;
      return draws.find((m) => m.type === 'draw' && m.from !== 'discard') ?? pick(draws);
    }

    // Keep the hand sorted into melds (an arrangement is free and always allowed).
    const sorted = input.sortedGroups();
    if (sorted && !sameGroups(sorted, currentGroups(view))) {
      return { player: view.you, type: 'arrange', groups: sorted };
    }

    // Put melds down: the team's first melds together, then any meld, then lay-offs.
    const meld =
      chooseValue(legal, ['layDown', 'askToGoOut']) ?? pick(of('meld')) ?? pick(of('layOff'));
    if (meld) return meld;

    const discards = of('discard');
    if (discards.length > 0) return discardLoose(input, goals, discards);
    // Anything left: show the hand, answer "yes", count.
    return chooseValue(legal, ['show', 'yes']);
  };
}

/** The first of these `choose` values that's legal. */
function chooseValue(legal: readonly Move[], values: readonly string[]): Move | null {
  for (const value of values) {
    const move = legal.find((m) => m.type === 'choose' && m.value === value);
    if (move) return move;
  }
  return null;
}

/** Throws away the loose card worth the most, keeping melds (and `keep` cards) together. */
function discardLoose(input: BotInput, goals: MeldGoals, discards: readonly Move[]): Move {
  const { view, file } = input;
  const hand = handOf(view, view.you);
  const inMelds = new Set(
    (view.arrangement?.groups ?? []).filter((g) => g.kind !== null).flatMap((g) => g.cards),
  );
  const score = (move: Move) => {
    const card = 'card' in move ? hand.find((c) => c.id === move.card) : undefined;
    if (!card) return -Infinity;
    if (goals.keep?.(card)) return -2000;
    if (inMelds.has(card.id)) return -1000 + cardPoints(file, card);
    return cardPoints(file, card);
  };
  return discards.reduce((a, b) => (score(b) > score(a) ? b : a));
}
