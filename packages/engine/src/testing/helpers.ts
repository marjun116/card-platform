/** Helpers for building exact test situations. */
import { applyMove } from '../api';
import { type Card, isRank, isSuit, jokerCard, type Suit, suitedCard } from '../cards/card';
import type { Move, PlayerId } from '../game/move';
import { enterPhase, settle } from '../game/flow';
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
  return moves.reduce(applyMove, state);
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
  return next;
}
