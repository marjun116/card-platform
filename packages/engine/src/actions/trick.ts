import { cardSuit } from '../cards/card';
import { ledSuit } from '../cards/order';
import { evaluateCondition } from '../expr/evaluate';
import type { Move, PlayerId } from '../game/move';
import { buildScope } from '../game/scope';
import { type GameState, takeCard, zoneCards, zoneKey } from '../game/state';
import type { PlayToTrickAction } from '../game/types';
import { type ActionResult, allowsCard } from './common';

export function playToTrickMoves(
  state: GameState,
  player: PlayerId,
  action: PlayToTrickAction,
): Move[] {
  const trick = state.trick;
  if (!trick) return [];
  const hand = zoneCards(state, zoneKey(state, 'hand', player));
  let cards = hand.filter((card) => allowsCard(state, player, action, card));

  if (trick.plays.length === 0) {
    const restriction = action.leadRestriction;
    const restricted =
      restriction &&
      !(restriction.unless && evaluateCondition(restriction.unless, buildScope(state, { player })));
    if (restricted) {
      const allowed = cards.filter((card) => cardSuit(card) !== restriction.cannotLead);
      // Never leave a player with no legal lead.
      if (allowed.length > 0) cards = allowed;
    }
  } else if (action.followSuit !== false) {
    const led = ledSuit(trick.plays.map((p) => p.card));
    const following = cards.filter((card) => cardSuit(card) === led);
    if (led && following.length > 0) cards = following;
  }

  return cards.map((card) => ({ player, type: 'playToTrick', card: card.id }));
}

export function applyPlayToTrick(state: GameState, move: Move): ActionResult {
  if (move.type !== 'playToTrick' || !state.trick) return {};
  const card = takeCard(state, zoneKey(state, 'hand', move.player), move.card);
  zoneCards(state, state.trick.zone).push(card);
  state.trick.plays.push({ player: move.player, card });
  return { card };
}
