/** The engine's public API. Every function is pure: inputs are never changed. */
import { IllegalMoveError } from './errors';
import { performMove, settle } from './game/flow';
import { candidates, findCandidate, getLegalMoves } from './game/legal';
import type { Move, PlayerId } from './game/move';
import { createGame } from './game/setup';
import { draft, type GameState } from './game/state';
import type { GameFile, OptionValue } from './game/types';
import { getScores } from './scoring';
import { viewFor } from './view';

export { createGame, getLegalMoves, getScores, viewFor };

/** Returns the state after the move. Throws IllegalMoveError if the move isn't legal now. */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.status === 'over') throw new IllegalMoveError('The game is over');
  const player = state.players[move.player];
  if (!player) throw new IllegalMoveError(`There is no player ${move.player}`);

  const candidate = findCandidate(state, move);
  if (!candidate) {
    const waitingOn = state.pending?.player ?? state.cursor.current;
    throw new IllegalMoveError(
      waitingOn !== move.player && move.type !== 'lookAtHand'
        ? `It's not player ${move.player}'s turn`
        : `That move isn't legal right now: ${JSON.stringify(move)}`,
    );
  }

  const next = draft(state);
  // Store the legal move exactly as the engine generated it.
  performMove(next, candidate, candidate.move);
  settle(next);
  return next;
}

export function isGameOver(state: GameState): boolean {
  return state.status === 'over';
}

/** Seats that have a move to make right now (ignoring "look at hand"). */
export function playersToAct(state: GameState): PlayerId[] {
  return state.players
    .filter((p) => candidates(state, p.id, { skipLook: true }).length > 0)
    .map((p) => p.id);
}

/** Rebuilds a game from its seed and move log. */
export function replay(
  file: GameFile,
  options: Record<string, OptionValue>,
  playerCount: number,
  seed: string,
  moves: readonly Move[],
): GameState {
  return moves.reduce(applyMove, createGame(file, options, playerCount, seed));
}
