import { describe, expect, it } from 'vitest';
import { tinyTricks } from '../__fixtures__/games';
import { hand, id, play } from '../testing';
import {
  applyMove,
  createGame,
  getLegalMoves,
  getScores,
  isGameOver,
  playersToAct,
  replay,
} from '../api';
import { IllegalMoveError } from '../errors';
import type { Move } from './move';

// Tiny Tricks deals without shuffling, so the hands are known:
// the player left of the dealer (L) gets 5S 3S 5H 3H, the dealer (D) gets 4S 2S 4H 2H.
function start() {
  const state = createGame(tinyTricks, {}, 2, 'flow');
  const D = state.dealer;
  const L = (D + 1) % 2;
  const trick = (player: number, spec: string): Move => ({
    player,
    type: 'playToTrick',
    card: id(spec),
  });
  return { state, D, L, trick };
}

describe('turns and tricks', () => {
  it('starts with the player left of the dealer leading', () => {
    const { state, L } = start();
    expect(state.cursor.current).toBe(L);
    expect(playersToAct(state)).toEqual([L]);
    expect(getLegalMoves(state, L)).toHaveLength(4);
  });

  it('gives no moves to a player whose turn it is not', () => {
    const { state, D } = start();
    expect(getLegalMoves(state, D)).toEqual([]);
  });

  it('requires following suit when possible', () => {
    const { state, L, D, trick } = start();
    const next = applyMove(state, trick(L, '3H'));
    expect(next.cursor.current).toBe(D);
    expect(getLegalMoves(next, D).map((m) => (m.type === 'playToTrick' ? m.card : ''))).toEqual([
      id('4H'),
      id('2H'),
    ]);
    expect(() => applyMove(next, trick(D, '4S'))).toThrow(IllegalMoveError);
  });

  it('gives the trick to the highest card of the led suit; the winner leads next', () => {
    const { state, L, D, trick } = start();
    const next = play(state, trick(L, '3H'), trick(D, '4H'));
    expect(next.lastTrick?.winner).toBe(D);
    expect(next.players[D]?.tricks).toBe(1);
    expect(next.zones[`won@${D}`]?.map((c) => c.id)).toEqual([id('3H'), id('4H')]);
    expect(next.zones.trick).toEqual([]);
    expect(next.cursor.current).toBe(D);
    expect(next.trick?.plays).toEqual([]);
  });

  it('scores the round and ends the game', () => {
    const { state, L, D, trick } = start();
    // D wins 4H over 3H; D leads 2S, L wins with 5S; L leads 5H (D: 2H), L leads 3S (D: 4S wins).
    const end = play(
      state,
      trick(L, '3H'),
      trick(D, '4H'),
      trick(D, '2S'),
      trick(L, '5S'),
      trick(L, '5H'),
      trick(D, '2H'),
      trick(L, '3S'),
      trick(D, '4S'),
    );
    expect(isGameOver(end)).toBe(true);
    expect(getScores(end).teams.map((t) => t.score)).toEqual([2, 2]); // two tricks each
    expect(end.winners).toEqual([0, 1]); // ties: "share"
    expect(() => applyMove(end, trick(L, '3H'))).toThrow('The game is over');
  });

  it('explains why a move is rejected', () => {
    const { state, D, L, trick } = start();
    expect(() => applyMove(state, trick(D, '4S'))).toThrow(`not player ${D}'s turn`);
    expect(() => applyMove(state, trick(L, '4S'))).toThrow("isn't legal right now");
    expect(() => applyMove(state, { player: 7, type: 'endTurn' })).toThrow('no player 7');
  });

  it('never changes the state it was given', () => {
    const { state, L, trick } = start();
    const before = JSON.stringify(state);
    applyMove(state, trick(L, '3H'));
    expect(JSON.stringify(state)).toBe(before);
    expect(hand(state, L)).toHaveLength(4);
  });

  it('records moves so a game can be replayed exactly', () => {
    const { state, L, D, trick } = start();
    const moves = [trick(L, '3H'), trick(D, '4H'), trick(D, '2S')];
    const played = play(state, ...moves);
    expect(played.log).toEqual(moves);
    expect(replay(tinyTricks, {}, 2, 'flow', moves)).toEqual(played);
  });
});
