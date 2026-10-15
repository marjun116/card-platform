/** Helpers for building exact test situations. */
import { applyMove } from '../api';
import { type Card, isRank, isSuit, jokerCard, type Suit, suitedCard } from '../cards/card';
import type { Move, PlayerId } from '../game/move';
import { dealNextRound, enterPhase, settle } from '../game/flow';
import { draft, type GameState } from '../game/state';

const SUIT_BY_LETTER: Record<string, Suit> = {
  C: 'clubs',
  D: 'diamonds',
  H: 'hearts',
  S: 'spades',
};

/**
 * "QH" → queen of hearts, "10S" → ten of spades (first deck copy), "10S.1" →
 * the second deck's ten of spades, "JOKER.1" → a joker.
 */
export function card(spec: string): Card {
  const joker = /^JOKER\.(\d+)$/.exec(spec);
  if (joker) return jokerCard(Number(joker[1]));
  const [code = '', copy = '0'] = spec.split('.');
  const rank = code.slice(0, -1);
  const suit = SUIT_BY_LETTER[code.slice(-1)];
  if (!isRank(rank) || !isSuit(suit) || !/^\d+$/.test(copy)) throw new Error(`Bad card "${spec}"`);
  return suitedCard(rank, suit, Number(copy));
}

export const id = (spec: string) => card(spec).id;

/**
 * Returns a copy of the state with the given zones set to exactly these
 * cards. The cards are removed from wherever else they were, so every card
 * still exists exactly once.
 */
export function withZones(
  state: GameState,
  zones: Record<string, string[]>,
  spare?: string,
): GameState {
  const next = draft(state);
  const placed = new Set(Object.values(zones).flat().map(id));
  for (const key of Object.keys(next.zones)) {
    next.zones[key] = (next.zones[key] ?? []).filter((c) => !placed.has(c.id));
  }
  const displaced: Card[] = [];
  for (const [key, specs] of Object.entries(zones)) {
    displaced.push(...(next.zones[key] ?? []));
    next.zones[key] = specs.map(card);
  }
  // Cards pushed out of the listed zones go underneath the spare zone, so none vanish.
  if (displaced.length > 0) {
    if (!spare) throw new Error(`withZones: ${displaced.length} cards need a spare zone`);
    next.zones[spare]?.unshift(...displaced);
  }
  return next;
}

/** Applies moves in order. */
export function play(state: GameState, ...moves: Move[]): GameState {
  return moves.reduce((next, move) => applyMove(next, move), state);
}

export const current = (state: GameState): PlayerId =>
  state.pending?.player ?? state.cursor.current;

export const hand = (state: GameState, seat: PlayerId) =>
  (state.zones[`hand@${seat}`] ?? []).map((c) => c.id);

/**
 * Starts the current phase again: for tests that changed the hands with
 * withZones and need the first player worked out from the new hands (e.g.
 * whoever holds the 2♣).
 */
export function restartPhase(state: GameState): GameState {
  const next = draft(state);
  enterPhase(next, next.cursor.phase);
  settle(next);
  // A round that ends straight away is dealt straight away, as applyMove does.
  if (next.status === 'betweenRounds') dealNextRound(next);
  return next;
}

/**
 * Returns a copy with these cards on top of the zone (`zone`, e.g. "stock"),
 * the first listed on the very top, so they're drawn first. A card that's
 * somewhere else trades places with the zone's bottom card, so every zone
 * keeps its size.
 */
export function onTop(state: GameState, zone: string, specs: string[]): GameState {
  const next = draft(state);
  const pile = next.zones[zone];
  if (!pile) throw new Error(`onTop: no zone "${zone}"`);
  for (const spec of [...specs].reverse()) {
    const wanted = id(spec);
    if (!pile.some((c) => c.id === wanted)) {
      const holder = Object.values(next.zones).find((cards) => cards.some((c) => c.id === wanted));
      const bottom = pile.shift();
      if (!holder || !bottom) throw new Error(`onTop: can't find ${spec}, or "${zone}" is empty`);
      const at = holder.findIndex((c) => c.id === wanted);
      pile.unshift(holder[at] as Card);
      holder[at] = bottom;
    }
    const index = pile.findIndex((c) => c.id === wanted);
    pile.push(...pile.splice(index, 1));
  }
  return next;
}
