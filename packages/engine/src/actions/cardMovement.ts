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
import { buildScope } from '../game/scope';
import {
  canShowHandWithout,
  checkedGroups,
  fitsMeld,
  groupUsesWild,
  meldRulesOf,
} from '../game/arrangement';
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
  // Effects of a one-card draw can refer to the card drawn as `card`.
  return drawn.length === 1 ? { drawn, card: drawn[0] } : { drawn };
}

// ---- pick up a whole pile ----

export function pickUpMoves(state: GameState, player: PlayerId, action: PickUpPileAction): Move[] {
  if (zoneCards(state, zoneKey(state, action.from, player)).length === 0) return [];
  if (!allowsCard(state, player, action)) return [];
  return [{ player, type: 'pickUpPile', from: action.from }];
}

export function applyPickUp(state: GameState, move: Move, action: PickUpPileAction): ActionResult {
  const pile = zoneCards(state, zoneKey(state, action.from, move.player));
  const drawn = pile.splice(0, pile.length);
  zoneCards(state, zoneKey(state, action.to ?? 'hand', move.player)).push(...drawn);
  return { drawn };
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
  for (const { cards, info } of checkedGroups(state, player)) {
    if (!info) continue;
    const meld = {
      kind: info.kind,
      size: cards.length,
      isPure: info.pure,
      usesWild: groupUsesWild(state, cards),
    };
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
  for (const zone of zoneInstances(state, action.to)) {
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
export function showHandMoves(state: GameState, player: PlayerId, action: ShowHandAction): Move[] {
  return handOf(state, player)
    .filter(cardsAllowed(state, player, action))
    .filter((card) => canShowHandWithout(state, player, card))
    .map((card) => ({ player, type: 'showHand', card: card.id, to: action.to }));
}

export function applyShowHand(state: GameState, move: Move, action: ShowHandAction): ActionResult {
  if (move.type !== 'showHand') return {};
  const card = takeCard(state, zoneKey(state, 'hand', move.player), move.card);
  zoneCards(state, zoneKey(state, action.to, move.player)).push(card);
  return { card };
}
