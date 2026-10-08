import { cardSuit } from '../cards/card';
import { ledSuit } from '../cards/order';
import { evaluateCondition } from '../expr/evaluate';
import type { Move, PlayerId } from '../game/move';
import { buildScope, withCard } from '../game/scope';
import { type GameState, suitOf, takeCard, zoneCards, zoneKey } from '../game/state';
import type { PlayRestriction, PlayToTrickAction } from '../game/types';
import type { Card } from '../cards/card';
import { type ActionResult, cardsAllowed } from './common';

export function playToTrickMoves(
  state: GameState,
  player: PlayerId,
  action: PlayToTrickAction,
): Move[] {
  const trick = state.trick;
  if (!trick) return [];
  const hand = zoneCards(state, zoneKey(state, 'hand', player));
  let cards = hand.filter(cardsAllowed(state, player, action));

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
    // With bowers the left bower follows trump, not its printed suit.
    const suit = suitOf(state);
    const led = ledSuit(
      trick.plays.map((p) => p.card),
      suit,
    );
    const following = cards.filter((card) => suit(card) === led);
    if (led && following.length > 0) cards = following;
  }

  for (const restriction of action.restrictions ?? []) {
    cards = restrict(state, player, cards, restriction);
  }

  return cards.map((card) => ({ player, type: 'playToTrick', card: card.id }));
}

/**
 * Keeps (mustPlay) or removes (cannotPlay) the matching cards, unless that
 * would leave nothing to play: "you can't lead hearts unless you have only
 * hearts" is cannotPlay hearts.
 */
function restrict(
  state: GameState,
  player: PlayerId,
  cards: Card[],
  restriction: PlayRestriction,
): Card[] {
  const scope = buildScope(state, { player });
  if (restriction.if && !evaluateCondition(restriction.if, scope)) return cards;
  const rule = restriction.mustPlay ?? restriction.cannotPlay;
  if (!rule) return cards;
  const keep = restriction.mustPlay !== undefined;
  const allowed = cards.filter((card) => evaluateCondition(rule, withCard(scope, card)) === keep);
  return allowed.length > 0 ? allowed : cards;
}

export function applyPlayToTrick(state: GameState, move: Move): ActionResult {
  if (move.type !== 'playToTrick' || !state.trick) return {};
  const card = takeCard(state, zoneKey(state, 'hand', move.player), move.card);
  zoneCards(state, state.trick.zone).push(card);
  state.trick.plays.push({ player: move.player, card });
  return { card };
}
