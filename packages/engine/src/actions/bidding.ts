import { SUITS } from '../cards/card';
import { GameFileError } from '../errors';
import type { BidValue, Move, PlayerId } from '../game/move';
import type { GameState, PlayerState } from '../game/state';
import { setVar } from '../effects';
import { evaluateCondition } from '../expr/evaluate';
import { buildScope } from '../game/scope';
import type { BidAction, ChooseAction, DeclareTrumpAction, PassBidAction } from '../game/types';
import { type ActionResult, allowsCard } from './common';

function bidValues(action: BidAction): BidValue[] {
  const { values } = action;
  if (Array.isArray(values)) return values;
  const [low, high] = values.range;
  if (!Number.isInteger(low) || !Number.isInteger(high) || low > high) {
    throw new GameFileError(`Bid range [${low}, ${high}] isn't valid`);
  }
  return Array.from({ length: high - low + 1 }, (_, i) => low + i);
}

/** One move per bid value the action's `if` allows; the `if` can read the `bid` in question. */
export function bidMoves(state: GameState, player: PlayerId, action: BidAction): Move[] {
  const condition = action.if;
  return bidValues(action)
    .filter((bid) => !condition || evaluateCondition(condition, buildScope(state, { player, bid })))
    .map((value) => ({ player, type: 'bid', value }));
}

export function passBidMoves(state: GameState, player: PlayerId, action: PassBidAction): Move[] {
  return allowsCard(state, player, action) ? [{ player, type: 'passBid' }] : [];
}

/** One move per suit the action's `if` allows; the `if` can read the `suit` in question. */
export function declareTrumpMoves(
  state: GameState,
  player: PlayerId,
  action: DeclareTrumpAction,
): Move[] {
  const condition = action.if;
  return (action.suits ?? SUITS)
    .filter(
      (suit) => !condition || evaluateCondition(condition, buildScope(state, { player, suit })),
    )
    .map((suit) => ({ player, type: 'declareTrump', suit }));
}

export function chooseMoves(state: GameState, player: PlayerId, action: ChooseAction): Move[] {
  if (!allowsCard(state, player, action)) return [];
  return action.values.map((value) => ({ player, type: 'choose', value }));
}

export function applyChoose(state: GameState, move: Move, action: ChooseAction): ActionResult {
  if (move.type === 'choose') setVar(state, action.set, move.value, move.player);
  return {};
}

export function applyBid(state: GameState, move: Move): ActionResult {
  const player = state.players[move.player] as PlayerState;
  if (move.type === 'bid') player.bid = move.value;
  else if (move.type === 'passBid') player.bid = 'pass';
  else if (move.type === 'declareTrump') state.vars.trump = move.suit;
  return {};
}
