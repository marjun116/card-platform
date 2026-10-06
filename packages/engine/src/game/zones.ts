import type { Card } from '../cards/card';
import { shuffle } from '../rng';
import type { ZoneKey } from './move';
import { type GameState, parseZoneKey, zoneCards } from './state';
import type { PhaseDef } from './types';

function currentPhase(state: GameState): PhaseDef | undefined {
  return state.file.phases[state.cursor.phase];
}

/** Can at least one card be drawn from this zone (counting a reshuffle)? */
export function canDraw(state: GameState, key: ZoneKey): boolean {
  if (zoneCards(state, key).length > 0) return true;
  const policy = currentPhase(state)?.whenEmpty?.[parseZoneKey(key).name];
  return policy === 'reshuffleDiscardExceptTop' && (state.zones.discard?.length ?? 0) > 1;
}

/**
 * Moves up to `count` cards from the top of one zone to another, refilling
 * the source first if the phase's `whenEmpty` rule says to. Returns the
 * cards moved (may be fewer than asked if both piles run out).
 */
export function drawCards(state: GameState, from: ZoneKey, to: ZoneKey, count: number): Card[] {
  const source = zoneCards(state, from);
  const target = zoneCards(state, to);
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (source.length === 0) refill(state, from);
    const card = source.pop();
    if (!card) break;
    target.push(card);
    drawn.push(card);
  }
  return drawn;
}

function refill(state: GameState, key: ZoneKey): void {
  const policy = currentPhase(state)?.whenEmpty?.[parseZoneKey(key).name];
  if (policy !== 'reshuffleDiscardExceptTop') return;
  const discard = state.zones.discard;
  if (!discard || discard.length < 2) return;
  const top = discard.pop() as Card;
  const rest = discard.splice(0, discard.length);
  shuffle(rest, state.rng);
  zoneCards(state, key).push(...rest);
  discard.push(top);
}
