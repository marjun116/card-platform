import type { Card } from '../cards/card';
import { ExprError } from '../errors';
import { evaluate, evaluateCondition, evaluateNumber } from '../expr/evaluate';
import { GameFileError } from '../errors';
import { shuffle } from '../rng';
import type { ZoneKey } from './move';
import { buildScope, type ScopeContext } from './scope';
import { type GameState, parseZoneKey, zoneCards } from './state';
import type { PhaseDef, WhenEmptyPolicy } from './types';

/**
 * The phase's rule for this zone running out, if there is one and its `if`
 * holds (for the player whose turn it is).
 */
function policyFor(state: GameState, key: ZoneKey): WhenEmptyPolicy | undefined {
  const phase: PhaseDef | undefined = state.file.phases[state.cursor.phase];
  const policy = phase?.whenEmpty?.[parseZoneKey(key).name];
  if (
    typeof policy === 'object' &&
    policy.if &&
    !evaluateCondition(policy.if, buildScope(state, { player: state.cursor.current }))
  ) {
    return undefined;
  }
  return policy;
}

/** A reshuffle rule (the plain string, or the object form with a limit), or null. */
function reshuffleRule(policy: WhenEmptyPolicy | undefined): { limit?: number | string } | null {
  if (policy === 'reshuffleDiscardExceptTop') return {};
  if (typeof policy === 'object' && policy.policy === 'reshuffleDiscardExceptTop') return policy;
  return null;
}

/** A card count that may be an expression ("state.penalty"): a whole number, 0 or more. */
export function cardCount(state: GameState, count: number | string, ctx: ScopeContext): number {
  const n = typeof count === 'number' ? count : evaluateNumber(count, buildScope(state, ctx));
  if (!Number.isInteger(n) || n < 0) {
    throw new GameFileError(`A number of cards must be a whole number, 0 or more (got ${n})`);
  }
  return n;
}

/**
 * How many more times this zone may be refilled from the discard pile this
 * round: Infinity if there's no limit, 0 if it can't be refilled at all.
 */
export function reshufflesLeft(state: GameState, key: ZoneKey): number {
  const policy = reshuffleRule(policyFor(state, key));
  if (!policy) return 0;
  if (policy.limit === undefined) return Infinity;
  const limit =
    typeof policy.limit === 'number' ? policy.limit : evaluate(policy.limit, buildScope(state));
  if (limit === null || limit === 'unlimited') return Infinity;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    throw new ExprError(
      `A reshuffle limit must be a whole number or "unlimited"`,
      String(policy.limit),
    );
  }
  return Math.max(0, limit - (state.reshuffles[key] ?? 0));
}

function canRefill(state: GameState, key: ZoneKey): boolean {
  return reshufflesLeft(state, key) > 0 && (state.zones.discard?.length ?? 0) > 1;
}

/** Can at least one card be drawn from this zone (counting a reshuffle)? */
export function canDraw(state: GameState, key: ZoneKey): boolean {
  return zoneCards(state, key).length > 0 || canRefill(state, key);
}

/**
 * Is this zone empty for good this round, with a rule saying that ends the
 * round? ("endRound", or a reshuffle limit that has been used up.)
 */
export function endsRoundWhenEmpty(state: GameState, key: ZoneKey): boolean {
  // A pile with cards in it never ends the round: check that before the rule's condition,
  // which can be costly (canasta asks whether the player could take the discard pile).
  if (zoneCards(state, key).length > 0) return false;
  const policy = policyFor(state, key);
  const ending =
    policy === 'endRound' ||
    (typeof policy === 'object' &&
      (policy.policy === 'endRound' || reshuffleRule(policy)?.limit !== undefined));
  return ending && zoneCards(state, key).length === 0 && !canRefill(state, key);
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
    if (source.length === 0 && canRefill(state, from)) refill(state, from);
    const card = source.pop();
    if (!card) break;
    target.push(card);
    drawn.push(card);
  }
  return drawn;
}

/** Turns the discard pile (all but its top card) into the new, shuffled stock. */
function refill(state: GameState, key: ZoneKey): void {
  const discard = state.zones.discard as Card[];
  const top = discard.pop() as Card;
  const rest = discard.splice(0, discard.length);
  shuffle(rest, state.rng);
  zoneCards(state, key).push(...rest);
  discard.push(top);
  state.reshuffles[key] = (state.reshuffles[key] ?? 0) + 1;
}
