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
  meldFacts,
  type MeldRules,
  usesWild,
} from '../actions/arrange';
import type { Card, CardId } from '../cards/card';
import { IllegalMoveError } from '../errors';
import { evaluate, evaluateCondition, type Scope } from '../expr/evaluate';
import { ACES } from '../schema/gameFile';
import type { PlayerId } from './move';
import { buildScope, cardObject, cardValue, type MeldContext, withCard, withMeld } from './scope';
import { resolveSetting } from './settings';
import { type GameState, meldsIn, zoneCards, zoneKey } from './state';

/**
 * The game's meld rules, or null if players don't arrange their hands in this
 * game. `goingOut`: the melds being judged would empty the player's hand
 * (some melds are only allowed then, such as canasta's black 3s).
 */
export function meldRulesOf(state: GameState, goingOut = false): MeldRules | null {
  const def = state.file.meldRules;
  if (!def) return null;
  const wild = state.file.cardOrder?.wild;
  // Whether a card is wild doesn't change while these rules are in use, so each card's
  // answer is worked out once (lay-offs check every card against every meld).
  const known = new Map<string, boolean>();
  const scope = wild || def.allowed ? buildScope(state) : null;
  const rules: MeldRules = {
    kinds: def.kinds ?? ['set', 'run'],
    minSize: def.minSize ?? 3,
    aces: resolveSetting(state, def.aces ?? 'low', ACES, 'Aces'),
    anySuits: def.sets === 'anySuits',
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
  const allowed = def.allowed;
  if (allowed) {
    rules.allows = (cards, info) =>
      evaluateCondition(
        allowed,
        withMeld(scope as Scope, meldContext(state, rules, cards, info, goingOut)),
      );
  }
  return rules;
}

/** What a meld condition sees as `meld`. */
export function meldContext(
  state: GameState,
  rules: MeldRules,
  cards: readonly Card[],
  info: GroupInfo,
  goingOut: boolean,
): MeldContext {
  const value = valueOf(state);
  return {
    ...meldFacts(cards, info, rules),
    points: cards.reduce((sum, c) => sum + value(c), 0),
    goingOut,
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

export function checkedGroups(
  state: GameState,
  player: PlayerId,
  goingOut = false,
): CheckedGroup[] {
  const rules = meldRulesOf(state, goingOut);
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
 * Every way the player could go out right now: the cards they could discard
 * (every other card being in a valid group, judged as going out), and whether
 * they could go out with no discard. Worked out in one pass over the groups:
 * at most one card can be outside them.
 */
export function goingOutWays(
  state: GameState,
  player: PlayerId,
): { discards: Set<Card>; withoutDiscard: boolean } {
  const none = { discards: new Set<Card>(), withoutDiscard: false };
  const rules = meldRulesOf(state, true);
  if (!rules) return none;
  const hand = handOf(state, player);
  const groups = heldGroups(state, player);
  const grouped = new Set(groups.flat());
  const loose = hand.filter((c) => !grouped.has(c));
  if (loose.length > 1) return none;
  const infos = groups.map((g) => groupInfo(g, rules));
  const pureNeeded = pureRunRequired(state) && !hasPureRunOnTable(state, player);
  const ok = (pure: boolean) => !pureNeeded || pure;
  const allValid = infos.every((info) => info !== null);
  const anyPure = infos.some((info) => info?.pure === true);

  if (loose.length === 1) {
    // Only the card outside the groups can go.
    return allValid && ok(anyPure) ? { discards: new Set(loose), withoutDiscard: false } : none;
  }
  const discards = new Set<Card>();
  const invalid = infos.filter((info) => info === null).length;
  groups.forEach((group, i) => {
    // Without this card its group must still be valid (or empty), and every other group too.
    const othersValid = invalid - (infos[i] === null ? 1 : 0) === 0;
    if (!othersValid) return;
    const othersPure = infos.some((info, j) => j !== i && info?.pure === true);
    for (const card of group) {
      const rest = group.filter((c) => c !== card);
      const info = rest.length === 0 ? null : groupInfo(rest, rules);
      if (rest.length > 0 && info === null) continue;
      if (ok(othersPure || info?.pure === true)) discards.add(card);
    }
  });
  return { discards, withoutDiscard: allValid && ok(anyPure) };
}

/**
 * Moves the player's valid groups from their hand to the table. When the
 * groups take every card in the hand, they're judged as going out.
 */
export function layOutMelds(state: GameState, player: PlayerId, zone: string): void {
  const hand = handOf(state, player);
  const out = checkedGroups(state, player, true);
  const goingOut =
    out.every((g) => g.info !== null) &&
    out.reduce((n, g) => n + g.cards.length, 0) === hand.length;
  const valid = (goingOut ? out : checkedGroups(state, player)).filter((g) => g.info !== null);
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
