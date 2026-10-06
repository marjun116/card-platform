import { SUITS } from '../cards/card';
import { GameFileError } from '../errors';
import type { BidValue, Move, PlayerId } from '../game/move';
import type { GameState, PlayerState } from '../game/state';
import type { BidAction, DeclareTrumpAction, PassBidAction } from '../game/types';
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

export function bidMoves(state: GameState, player: PlayerId, action: BidAction): Move[] {
  if (!allowsCard(state, player, action)) return [];
  return bidValues(action).map((value) => ({ player, type: 'bid', value }));
}

export function passBidMoves(state: GameState, player: PlayerId, action: PassBidAction): Move[] {
  return allowsCard(state, player, action) ? [{ player, type: 'passBid' }] : [];
}

export function declareTrumpMoves(
  state: GameState,
  player: PlayerId,
  action: DeclareTrumpAction,
): Move[] {
  if (!allowsCard(state, player, action)) return [];
  return (action.suits ?? SUITS).map((suit) => ({ player, type: 'declareTrump', suit }));
}

export function applyBid(state: GameState, move: Move): ActionResult {
  const player = state.players[move.player] as PlayerState;
  if (move.type === 'bid') player.bid = move.value;
  else if (move.type === 'passBid') player.bid = 'pass';
  else if (move.type === 'declareTrump') state.vars.trump = move.suit;
  return {};
}
