/**
 * Hands that players arrange themselves (games with `meldRules`): each
 * player's groups, which of them are valid melds, deadwood, "Sort into
 * melds", and moving groups onto the table.
 */
import {
  bestArrangement,
  canAddToMeld,
  type GroupInfo,
  groupInfo,
  type MeldRules,
  usesWild,
} from '../actions/arrange';
import type { Card, CardId } from '../cards/card';
import { IllegalMoveError } from '../errors';
import { evaluate, evaluateCondition, type Scope } from '../expr/evaluate';
import { ACES } from '../schema/gameFile';
import type { PlayerId } from './move';
import { buildScope, cardObject, cardValue, withCard } from './scope';
import { resolveSetting } from './settings';
import { type GameState, meldsIn, zoneCards, zoneKey } from './state';

/** The game's meld rules, or null if players don't arrange their hands in this game. */
export function meldRulesOf(state: GameState): MeldRules | null {
  const def = state.file.meldRules;
  if (!def) return null;
  const wild = state.file.cardOrder?.wild;
  // Whether a card is wild doesn't change while these rules are in use, so each card's
  // answer is worked out once (lay-offs check every card against every meld).
  const known = new Map<string, boolean>();
  const scope = wild ? buildScope(state) : null;
  return {
    kinds: def.kinds ?? ['set', 'run'],
    minSize: def.minSize ?? 3,
    aces: resolveSetting(state, def.aces ?? 'low', ACES, 'Aces'),
    isWild: (card) => {
      if (!wild) return false;
      let answer = known.get(card.id);
      if (answer === undefined) {
        answer = evaluateCondition(wild, withCard(scope as Scope, card));
        known.set(card.id, answer);
      }
      return answer;
    },
  };
}

function flag(state: GameState, value: boolean | string | undefined, otherwise: boolean): boolean {
  if (value === undefined) return otherwise;
  if (typeof value === 'boolean') return value;
  return evaluate(value, buildScope(state)) === true;
}

export function pureRunRequired(state: GameState): boolean {
  return flag(state, state.file.meldRules?.pureRunRequired, false);
}

export function autoArrangeAllowed(state: GameState): boolean {
  return state.file.meldRules !== undefined && flag(state, state.file.meldRules.autoArrange, true);
}

const handOf = (state: GameState, player: PlayerId) =>
  zoneCards(state, zoneKey(state, 'hand', player));

const meldZone = (state: GameState) => state.file.meldRules?.zone ?? 'melds';

export const valueOf = (state: GameState) => (card: Card) => cardValue(state, cardObject(card));

/** The player's groups, keeping only cards still in their hand. */
export function heldGroups(state: GameState, player: PlayerId): Card[][] {
  const hand = new Map(handOf(state, player).map((c) => [c.id, c]));
  return (state.players[player]?.groups ?? [])
    .map((group) => group.flatMap((id) => hand.get(id) ?? []))
    .filter((group) => group.length > 0);
}

export interface CheckedGroup {
  cards: Card[];
  info: GroupInfo | null;
}

export function checkedGroups(state: GameState, player: PlayerId): CheckedGroup[] {
  const rules = meldRulesOf(state);
  return heldGroups(state, player).map((cards) => ({
    cards,
    info: rules ? groupInfo(cards, rules) : null,
  }));
}

/** Has the player a pure run among their melds on the table? */
export function hasPureRunOnTable(state: GameState, player: PlayerId): boolean {
  const rules = meldRulesOf(state);
  const zone = state.file.zones[meldZone(state)];
  if (!rules || !zone?.melds) return false;
  return meldsIn(state, zoneKey(state, meldZone(state), player)).some(
    (meld) => groupInfo(meld, rules)?.pure === true,
  );
}

/**
 * Points of the cards in the player's hand outside valid groups. If a pure run
 * is needed and they have none (in their groups or on the table), every card counts.
 */
export function deadwood(state: GameState, player: PlayerId): number {
  const value = valueOf(state);
  const hand = handOf(state, player);
  const valid = checkedGroups(state, player).filter((g) => g.info !== null);
  const pure = valid.some((g) => g.info?.pure) || hasPureRunOnTable(state, player);
  const counted =
    pureRunRequired(state) && !pure
      ? hand
      : hand.filter((c) => !valid.some((g) => g.cards.includes(c)));
  return counted.reduce((sum, c) => sum + value(c), 0);
}

/** Replaces the player's groups after checking every card is theirs and used once. */
export function arrange(state: GameState, player: PlayerId, groups: readonly CardId[][]): void {
  const target = state.players[player];
  if (!state.file.meldRules || !target) {
    throw new IllegalMoveError("This game doesn't use arranged hands");
  }
  const hand = new Set(handOf(state, player).map((c) => c.id));
  const seen = new Set<string>();
  for (const id of groups.flat()) {
    if (!hand.has(id)) throw new IllegalMoveError(`${id} isn't in your hand`);
    if (seen.has(id)) throw new IllegalMoveError(`${id} is in two groups`);
    seen.add(id);
  }
  target.groups = groups.filter((g) => g.length > 0).map((g) => [...g]);
}

/** "Sort into melds": the arrangement with the least deadwood. */
export function sortHand(state: GameState, player: PlayerId): void {
  const rules = meldRulesOf(state);
  const target = state.players[player];
  if (!rules || !target) return;
  const best = bestArrangement(
    handOf(state, player),
    rules,
    valueOf(state),
    pureRunRequired(state) && !hasPureRunOnTable(state, player),
  );
  target.groups = best.groups.map((g) => g.map((c) => c.id));
}

/**
 * Could the player go out by discarding this card? Every other card must be in
 * a valid group (still valid without this card), with a pure run if needed.
 */
export function canShowHandWithout(state: GameState, player: PlayerId, card: Card): boolean {
  const rules = meldRulesOf(state);
  if (!rules) return false;
  const rest = handOf(state, player).filter((c) => c !== card);
  const groups = heldGroups(state, player)
    .map((g) => g.filter((c) => c !== card))
    .filter((g) => g.length > 0);
  const infos = groups.map((g) => groupInfo(g, rules));
  if (infos.some((info) => info === null)) return false;
  if (groups.flat().length !== rest.length) return false;
  const pure = infos.some((info) => info?.pure) || hasPureRunOnTable(state, player);
  return !pureRunRequired(state) || pure;
}

/** Moves the player's valid groups from their hand to the table. */
export function layOutMelds(state: GameState, player: PlayerId, zone: string): void {
  const valid = checkedGroups(state, player).filter((g) => g.info !== null);
  const hand = handOf(state, player);
  const table = meldsIn(state, zoneKey(state, zone, player));
  for (const { cards } of valid) {
    table.push(cards);
    for (const c of cards) hand.splice(hand.indexOf(c), 1);
  }
}

export function groupUsesWild(state: GameState, cards: readonly Card[]): boolean {
  const rules = meldRulesOf(state);
  return rules !== null && usesWild(cards, rules);
}

/** Can this card join that meld on the table (with wild cards, under these meld rules)? */
export function fitsMeld(rules: MeldRules, meld: readonly Card[], card: Card): boolean {
  return canAddToMeld(meld, card, rules);
}
