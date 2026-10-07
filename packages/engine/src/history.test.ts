import { describe, expect, it } from 'vitest';
import { spades, tinyTricks } from './__fixtures__/games';
import { applyMove, createGame, getLegalMoves, playersToAct, viewFor } from './api';
import type { GameState } from './game/state';

/** Plays each seat's first legal move until `done` says stop. */
function playUntil(state: GameState, done: (s: GameState) => boolean): GameState {
  while (!done(state) && state.status === 'inProgress') {
    const seat = playersToAct(state)[0] as number;
    const move = getLegalMoves(state, seat)[0];
    if (!move) throw new Error(`Seat ${seat} has no legal move`);
    state = applyMove(state, move);
  }
  return state;
}

describe('round history', () => {
  it('starts empty', () => {
    expect(createGame(spades, {}, 4, 'history').history).toEqual([]);
  });

  it('records bids, tricks and points when a round is scored', () => {
    const start = createGame(spades, {}, 4, 'history');
    const lastMove = playUntil(start, (s) => s.cursor.tricks === 12 && s.trick?.plays.length === 3);
    const after = playUntil(lastMove, (s) => s.round === 2);

    expect(after.history).toHaveLength(1);
    const [result] = after.history;
    expect(result?.round).toBe(1);
    expect(result?.dealer).toBe(start.dealer);
    expect(result?.players.map((p) => p.bid)).toEqual(lastMove.players.map((p) => p.bid));
    expect(result?.players.reduce((sum, p) => sum + p.tricks, 0)).toBe(13);
    for (const team of result?.teams ?? []) {
      // The first round's points are the whole score.
      expect(team.points).toBe(team.score);
      expect(team.score).toBe(after.teams[team.id]?.score);
    }
    // A new round has started with fresh bids, but the history keeps the old ones.
    expect(after.players.every((p) => p.bid === null)).toBe(true);
  });

  it('records points as the change in score, not the total', () => {
    const state = playUntil(createGame(spades, {}, 4, 'history'), (s) => s.round === 3);
    const [first, second] = state.history;
    for (const team of second?.teams ?? []) {
      expect(team.points).toBe(team.score - (first?.teams[team.id]?.score ?? 0));
    }
  });

  it('is in every player view, and never changed by later moves', () => {
    const state = playUntil(createGame(tinyTricks, {}, 2, 'history'), (s) => s.status === 'over');
    expect(state.history).toHaveLength(1);
    expect(viewFor(state, 0).history).toEqual(state.history);
    expect(viewFor(state, 1).history).toEqual(state.history);
  });
});
