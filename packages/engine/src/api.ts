/** The engine's public API. Every function is pure: inputs are never changed. */
import { GameFileError, IllegalMoveError } from './errors';
import { dealNextRound as deal, performMove, settle } from './game/flow';
import { findCandidate, getLegalMoves, stableCandidates } from './game/legal';
import type { Move, PlayerId } from './game/move';
import { startGame } from './game/setup';
import { draft, type GameState } from './game/state';
import type { GameFile, OptionValue } from './game/types';
import { noteMoments, readMoments } from './moments';
import { formatIssues, validate } from './schema/validate';
import { getScores } from './scoring';
import { viewFor } from './view';

export { getLegalMoves, getScores, viewFor };

// Files that passed validation, so each file object is only checked once.
const validated = new WeakSet<object>();

/**
 * Starts a new game. The file is validated first (once per file object);
 * an invalid file throws GameFileError listing every problem. Same file,
 * options, player count and seed always give the same game.
 */
export function createGame(
  file: GameFile,
  options: Record<string, OptionValue>,
  playerCount: number,
  seed: string,
): GameState {
  if (!validated.has(file)) {
    const result = validate(file);
    if (!result.ok) {
      throw new GameFileError(`${file.meta.name} has problems:\n${formatIssues(result.errors)}`);
    }
    validated.add(file);
  }
  return startGame(file, options, playerCount, seed);
}

export interface ApplyOptions {
  /**
   * When the move ends a round, stop once it's scored, with the round's cards still
   * on the table (status `betweenRounds`), instead of dealing the next one straight
   * away; dealNextRound deals it. Either way the game goes on identically.
   */
  holdNextRound?: boolean;
}

/** Returns the state after the move. Throws IllegalMoveError if the move isn't legal now. */
export function applyMove(state: GameState, move: Move, options: ApplyOptions = {}): GameState {
  if (state.status === 'over') throw new IllegalMoveError('The game is over');
  if (state.status === 'betweenRounds') {
    throw new IllegalMoveError("The next round hasn't been dealt yet");
  }
  const player = state.players[move.player];
  if (!player) throw new IllegalMoveError(`There is no player ${move.player}`);

  // An arrangement can't be listed among the legal moves (there are far too many);
  // it's checked as it's applied.
  if (move.type === 'arrange') {
    if (move.by !== undefined) throw new IllegalMoveError('Only you can arrange your hand');
    const next = draft(state);
    performMove(next, { move, step: -1, action: null }, move);
    return next;
  }

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
  const moments = readMoments(state);
  // Store the legal move exactly as the engine generated it.
  performMove(next, candidate, candidate.move);
  settle(next);
  // Before the next deal, so a moment at the end of a round (all 26 points) is seen.
  noteMoments(next, moments);
  if (next.status === 'betweenRounds' && !options.holdNextRound) deal(next);
  return next;
}

/** True when a round has been scored and the next one is waiting to be dealt. */
export function isBetweenRounds(state: GameState): boolean {
  return state.status === 'betweenRounds';
}

/** Deals the next round of a game held between rounds (see ApplyOptions.holdNextRound). */
export function dealNextRound(state: GameState): GameState {
  if (state.status !== 'betweenRounds') {
    throw new IllegalMoveError("The game isn't waiting for the next round");
  }
  const next = draft(state);
  deal(next);
  return next;
}

export function isGameOver(state: GameState): boolean {
  return state.status === 'over';
}

/** Seats that have a move to make right now (ignoring "look at hand"). */
export function playersToAct(state: GameState): PlayerId[] {
  return state.players
    .filter((p) => stableCandidates(state, p.id, { skipLook: true }).length > 0)
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
  return moves.reduce(
    (state, move) => applyMove(state, move),
    createGame(file, options, playerCount, seed),
  );
}
