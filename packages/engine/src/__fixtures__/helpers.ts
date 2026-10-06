/** Helpers for building exact test situations. */
import { applyMove } from '../api';
import { type Card, isRank, isSuit, type Suit, suitedCard } from '../cards/card';
import type { Move, PlayerId } from '../game/move';
import { draft, type GameState } from '../game/state';

const SUIT_BY_LETTER: Record<string, Suit> = {
  C: 'clubs',
  D: 'diamonds',
  H: 'hearts',
  S: 'spades',
};

/** "QH" → queen of hearts, "10S" → ten of spades (first deck copy). */
export function card(spec: string): Card {
  const rank = spec.slice(0, -1);
  const suit = SUIT_BY_LETTER[spec.slice(-1)];
  if (!isRank(rank) || !isSuit(suit)) throw new Error(`Bad card "${spec}"`);
  return suitedCard(rank, suit);
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
  // Cards pushed out of the listed zones go to the spare zone, so none vanish.
  if (displaced.length > 0) {
    if (!spare) throw new Error(`withZones: ${displaced.length} cards need a spare zone`);
    next.zones[spare]?.push(...displaced);
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
