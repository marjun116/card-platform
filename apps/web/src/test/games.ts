/**
 * Real game views for web tests, made with the engine and its test game
 * files, so the table is tested against several kinds of game, not just one.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  playersToAct,
  viewFor,
} from '@card-table/engine';
import type { GameMessage } from '../table/connection';

// The engine's hand-written test games (not part of its public API).
export {
  miniRummy,
  passing,
  sevensUp,
  spades,
  wildRummy,
} from '../../../../packages/engine/src/__fixtures__/games';
export { createGame };

/** What the server would send a seat: its view and legal moves. */
export function gameMessage(state: GameState, seat: number): GameMessage {
  return {
    type: 'game',
    seq: state.log.length,
    view: viewFor(state, seat),
    legalMoves: getLegalMoves(state, seat),
    toAct: playersToAct(state),
  };
}

/** Plays the first legal move of whoever is to act until `done` says stop. */
export function playUntil(
  state: GameState,
  done: (state: GameState) => boolean,
  choose: (moves: Move[]) => Move | undefined = (moves) => moves[0],
): GameState {
  for (let i = 0; i < 5000 && !done(state); i++) {
    const seat = playersToAct(state)[0];
    if (seat === undefined) break;
    const move = choose(getLegalMoves(state, seat));
    if (!move) throw new Error(`Seat ${seat} has no legal move`);
    state = applyMove(state, move);
  }
  return state;
}
