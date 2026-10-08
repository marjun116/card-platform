import { GameFileError } from '../errors';
import { resolveSetting } from '../game/settings';
import { PASS_DIRECTIONS } from '../schema/gameFile';
import type { Move, PlayerId } from '../game/move';
import {
  type GameState,
  meldsIn,
  nextActive,
  takeCard,
  zoneCards,
  zoneInstances,
  zoneKey,
} from '../game/state';
import { canDraw, cardCount, drawCards } from '../game/zones';
import { evaluateCondition } from '../expr/evaluate';
import { buildScope, withCard } from '../game/scope';
import {
  checkedGroups,
  goingOutWays,
  fitsMeld,
  meldContext,
  meldRulesOf,
} from '../game/arrangement';
import { canAddToMeld, groupInfo } from './arrange';
import { type Card, cardCode } from '../cards/card';
import type {
  DiscardAction,
  DrawAction,
  LayOffAction,
  MeldAction,
  PassAction,
  PassDirection,
  PickUpPileAction,
  PlayAction,
  ShowHandAction,
} from '../game/types';
import { type ActionResult, allowsCard, cardsAllowed, combinations } from './common';
import { canLayOff, findMelds, sortMeld } from './melds';

const handOf = (state: GameState, player: PlayerId, from = 'hand') =>
  zoneCards(state, zoneKey(state, from, player));

const rankOrder = (state: GameState) => state.file.cardOrder?.ranks;

// ---- play / discard: one card from hand to a zone ----

export function playMoves(
  state: GameState,
  player: PlayerId,
  action: PlayAction | DiscardAction,
): Move[] {
  return handOf(state, player, action.from)
    .filter(cardsAllowed(state, player, action))
    .map((card) => ({ player, type: action.type, card: card.id, to: action.to }));
}

export function applyPlay(
  state: GameState,
  move: Move,
  action: PlayAction | DiscardAction,
): ActionResult {
  if (move.type !== 'play' && move.type !== 'discard') return {};
  const card = takeCard(state, zoneKey(state, action.from ?? 'hand', move.player), move.card);
  zoneCards(state, zoneKey(state, action.to, move.player)).push(card);
  state.playedBy[card.id] = move.player;
  return { card };
}

// ---- draw ----

export function drawMoves(state: GameState, player: PlayerId, action: DrawAction): Move[] {
  if (!canDraw(state, zoneKey(state, action.from, player))) return [];
  if (!allowsCard(state, player, action)) return [];
  return [{ player, type: 'draw', from: action.from }];
}

export function applyDraw(state: GameState, move: Move, action: DrawAction): ActionResult {
  const drawn = drawCards(
    state,
    zoneKey(state, action.from, move.player),
    zoneKey(state, action.to ?? 'hand', move.player),
    cardCount(state, action.count ?? 1, { player: move.player }),
  );
  state.cursor.draws += drawn.length;
  if ((action.to ?? 'hand') === 'hand') layDownBonusCards(state, move.player, true);
  // Effects of a one-card draw can refer to the card drawn as `card`.
  return drawn.length === 1 ? { drawn, card: drawn[0] } : { drawn };
}

// ---- pick up a whole pile ----

export function pickUpMoves(state: GameState, player: PlayerId, action: PickUpPileAction): Move[] {
  const pile = zoneCards(state, zoneKey(state, action.from, player));
  if (pile.length === 0) return [];
  if (action.meldTop) return meldTopMoves(state, player, action, pile[pile.length - 1] as Card);
  if (!allowsCard(state, player, action)) return [];
  return [{ player, type: 'pickUpPile', from: action.from }];
}

/**
 * Ways to take a pile by melding its top card: a new meld with cards from the
 * hand, or the top card added to one of the player's own melds. The action's
 * `if` sees the top card as `card` and the meld as `meld` (with `isNew`).
 */
function meldTopMoves(
  state: GameState,
  player: PlayerId,
  action: PickUpPileAction,
  top: Card,
): Move[] {
  const rules = meldRulesOf(state);
  const meldTop = action.meldTop;
  if (!rules || !meldTop) return [];
  const allowed = (cards: Card[], isNew: boolean, using: Card[]) => {
    const info = groupInfo(cards, rules);
    if (!info) return false;
    if (!action.if) return true;
    const meld = { ...meldContext(state, rules, cards, info, false), isNew };
    const ctx = { player, card: top, meld, using: new Set(using.map((c) => c.id)) };
    return evaluateCondition(action.if, buildScope(state, ctx));
  };
  const moves: Move[] = [];
  const seen = new Set<string>();
  // New melds: identical cards (two decks) make the same meld, so offer it once.
  for (const cards of combinations(handOf(state, player), meldTop.cards ?? rules.minSize - 1)) {
    const key = cards
      .map((c) => cardCode(c))
      .sort()
      .join(',');
    if (seen.has(key) || !allowed([top, ...cards], true, cards)) continue;
    seen.add(key);
    moves.push({ player, type: 'pickUpPile', from: action.from, cards: cards.map((c) => c.id) });
  }
  const zone = zoneKey(state, meldTop.to, player);
  meldsIn(state, zone).forEach((meld, index) => {
    if (canAddToMeld(meld, top, rules) && allowed([...meld, top], false, [])) {
      moves.push({ player, type: 'pickUpPile', from: action.from, meld: { zone, index } });
    }
  });
  return moves;
}

export function applyPickUp(state: GameState, move: Move, action: PickUpPileAction): ActionResult {
  if (move.type !== 'pickUpPile') return {};
  const pile = zoneCards(state, zoneKey(state, action.from, move.player));
  const top = action.meldTop ? pile.pop() : undefined;
  const drawn = pile.splice(0, pile.length);
  zoneCards(state, zoneKey(state, action.to ?? 'hand', move.player)).push(...drawn);
  let formed: Card[] | null = null;
  if (action.meldTop && top) {
    const zone = zoneKey(state, action.meldTop.to, move.player);
    const hand = zoneKey(state, 'hand', move.player);
    if (move.meld) {
      formed = meldsIn(state, move.meld.zone)[move.meld.index] ?? null;
      if (!formed) throw new GameFileError(`No meld ${move.meld.index} in ${move.meld.zone}`);
      formed.push(top);
    } else {
      formed = [top, ...(move.cards ?? []).map((id) => takeCard(state, hand, id))];
      meldsIn(state, zone).push(formed);
    }
    sortMeld(formed, rankOrder(state));
  }
  // Bonus cards taken with the pile are laid down, but not replaced.
  if ((action.to ?? 'hand') === 'hand') layDownBonusCards(state, move.player, false);
  if (!top) return { drawn };
  const rules = meldRulesOf(state);
  const info = formed && rules ? groupInfo(formed, rules) : null;
  const meld =
    formed && rules && info
      ? { ...meldContext(state, rules, formed, info, false), isNew: !move.meld }
      : undefined;
  return meld ? { drawn, card: top, meld } : { drawn, card: top };
}

/**
 * Lays down the bonus cards (`bonusCards`, such as red 3s) in the player's
 * hand, replacing each from `replaceFrom` when `replace` is true (and laying
 * down any bonus card that brings).
 */
export function layDownBonusCards(state: GameState, player: PlayerId, replace: boolean): void {
  const bonus = state.file.bonusCards;
  if (!bonus) return;
  const hand = handOf(state, player);
  const target = zoneCards(state, zoneKey(state, bonus.to, player));
  for (let guard = 0; guard < 100; guard++) {
    const scope = buildScope(state, { player });
    const found = hand.filter((card) => evaluateCondition(bonus.if, withCard(scope, card)));
    if (found.length === 0) return;
    for (const card of found) {
      hand.splice(hand.indexOf(card), 1);
      target.push(card);
    }
    if (!replace || !bonus.replaceFrom) return;
    const drawn = drawCards(
      state,
      zoneKey(state, bonus.replaceFrom, player),
      zoneKey(state, 'hand', player),
      found.length,
    );
    if (drawn.length === 0) return;
  }
}

// ---- pass cards to another player ----

type Direction = (typeof PASS_DIRECTIONS)[number];

/**
 * Where the rotating patterns pass each round (null = hold). "across" only
 * exists with four players.
 */
function rotation(direction: 'rotate' | 'rotateNoHold', players: number): (Direction | null)[] {
  const across: (Direction | null)[] = players === 4 ? ['across'] : [];
  return ['left', 'right', ...across, ...(direction === 'rotate' ? [null] : [])];
}

/** Who receives this player's passed cards, or null for a "hold" round. */
export function passTarget(
  state: GameState,
  player: PlayerId,
  setting: PassDirection,
): PlayerId | null {
  const direction = resolveSetting(state, setting, PASS_DIRECTIONS, 'Pass direction');
  const active = state.players.filter((p) => p.active).length;
  if (direction === 'rotate' || direction === 'rotateNoHold') {
    const cycle = rotation(direction, active);
    const turn = cycle[(state.round - 1) % cycle.length] ?? null;
    return turn && passTarget(state, player, turn);
  }
  if (direction === 'left') return nextActive(state, player, 1);
  if (direction === 'right') return nextActive(state, player, -1);
  // across: half-way round the table (only with an even number of players)
  if (active % 2 !== 0) return null;
  let target = player;
  for (let i = 0; i < active / 2; i++) target = nextActive(state, target, 1);
  return target;
}

export function passMoves(state: GameState, player: PlayerId, action: PassAction): Move[] {
  if (passTarget(state, player, action.direction) === null) return [];
  if (!allowsCard(state, player, action)) return [];
  const ids = handOf(state, player, action.from)
    .map((c) => c.id)
    .sort();
  return combinations(ids, action.count).map((cards) => ({ player, type: 'pass', cards }));
}

export function applyPass(state: GameState, move: Move, action: PassAction): ActionResult {
  if (move.type !== 'pass') return {};
  const target = passTarget(state, move.player, action.direction);
  if (target === null) throw new GameFileError('No one to pass to');
  const key = zoneKey(state, action.from ?? 'hand', move.player);
  const cards = move.cards.map((id) => takeCard(state, key, id));
  (state.passing[target] ??= []).push(...cards);
  return {};
}

// ---- melds ----

export function meldMoves(state: GameState, player: PlayerId, action: MeldAction): Move[] {
  if (state.file.meldRules) return groupMeldMoves(state, player, action);
  if (!allowsCard(state, player, action)) return [];
  const melds = findMelds(
    handOf(state, player, action.from),
    action.kinds ?? ['set', 'run'],
    action.minSize ?? 3,
    rankOrder(state),
  );
  return melds.map((meld) => ({ player, type: 'meld', cards: meld.map((c) => c.id).sort() }));
}

/** With meld rules, a player melds one of the valid groups they've arranged. */
function groupMeldMoves(state: GameState, player: PlayerId, action: MeldAction): Move[] {
  const moves: Move[] = [];
  const rules = meldRulesOf(state);
  for (const { cards, info } of checkedGroups(state, player)) {
    if (!info || !rules) continue;
    const meld = meldContext(state, rules, cards, info, false);
    if (action.if && !evaluateCondition(action.if, buildScope(state, { player, meld }))) continue;
    moves.push({ player, type: 'meld', cards: cards.map((c) => c.id).sort() });
  }
  return moves;
}

export function applyMeld(state: GameState, move: Move, action: MeldAction): ActionResult {
  if (move.type !== 'meld') return {};
  const key = zoneKey(state, action.from ?? 'hand', move.player);
  const meld = move.cards.map((id) => takeCard(state, key, id));
  sortMeld(meld, rankOrder(state));
  meldsIn(state, zoneKey(state, action.to, move.player)).push(meld);
  return {};
}

export function layOffMoves(state: GameState, player: PlayerId, action: LayOffAction): Move[] {
  const moves: Move[] = [];
  const hand = handOf(state, player, action.from).filter(cardsAllowed(state, player, action));
  const rules = meldRulesOf(state);
  const zones = action.own ? [zoneKey(state, action.to, player)] : zoneInstances(state, action.to);
  for (const zone of zones) {
    meldsIn(state, zone).forEach((meld, index) => {
      for (const card of hand) {
        const fits = rules ? fitsMeld(rules, meld, card) : canLayOff(meld, card, rankOrder(state));
        if (fits) {
          moves.push({ player, type: 'layOff', card: card.id, meld: { zone, index } });
        }
      }
    });
  }
  return moves;
}

export function applyLayOff(state: GameState, move: Move, action: LayOffAction): ActionResult {
  if (move.type !== 'layOff') return {};
  const card = takeCard(state, zoneKey(state, action.from ?? 'hand', move.player), move.card);
  const meld = meldsIn(state, move.meld.zone)[move.meld.index];
  if (!meld) throw new GameFileError(`No meld ${move.meld.index} in ${move.meld.zone}`);
  meld.push(card);
  sortMeld(meld, rankOrder(state));
  return { card };
}

// ---- go out by showing your hand ----

/** Discards that leave every other card in a valid group. */
/**
 * Discards that leave every other card in a valid group (judged as going
 * out), and with `discard: "optional"` going out with no discard at all.
 */
export function showHandMoves(state: GameState, player: PlayerId, action: ShowHandAction): Move[] {
  const discard = action.discard ?? true;
  // Whether the hand can go out is checked before the game's condition, which can be costly.
  const ways = goingOutWays(state, player);
  const moves: Move[] =
    discard === false
      ? []
      : handOf(state, player)
          .filter((card) => ways.discards.has(card))
          .filter(cardsAllowed(state, player, action))
          .map((card) => ({ player, type: 'showHand', card: card.id, to: action.to }));
  if (discard !== true && ways.withoutDiscard && allowsCard(state, player, action)) {
    moves.push({ player, type: 'showHand', card: null, to: action.to });
  }
  return moves;
}

export function applyShowHand(state: GameState, move: Move, action: ShowHandAction): ActionResult {
  if (move.type !== 'showHand' || move.card === null) return {};
  const card = takeCard(state, zoneKey(state, 'hand', move.player), move.card);
  zoneCards(state, zoneKey(state, action.to, move.player)).push(card);
  return { card };
}
