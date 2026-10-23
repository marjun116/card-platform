import { describe, expect, it } from 'vitest';
import { spades, tinyTricks } from './__fixtures__/games';
import {
  applyMove,
  createGame,
  dealNextRound,
  getLegalMoves,
  isBetweenRounds,
  playersToAct,
} from './api';
import type { Move } from './game/move';
import type { GameState } from './game/state';
import type { GameFile } from './game/types';
import { replayRound } from './roundReplay';

/** Plays first legal moves as the server does (holding each deal), keeping the move log. */
function play(file: GameFile, seed: string, done: (s: GameState) => boolean) {
  let state = createGame(file, {}, 4, seed);
  const moves: Move[] = [];
  while (!done(state) && state.status !== 'over') {
    if (isBetweenRounds(state)) {
      state = dealNextRound(state);
      continue;
    }
    const seat = playersToAct(state)[0] as number;
    const move = getLegalMoves(state, seat)[0] as Move;
    moves.push(move);
    state = applyMove(state, move, { holdNextRound: true });
  }
  return { state, moves };
}

const replay = (moves: Move[], round: number) => replayRound(spades, {}, 4, 'replay', moves, round);

describe('replayRound', () => {
  const { state, moves } = play(spades, 'replay', (s) => s.history.length === 2);

  it('plays a finished round back from the deal, a frame per move', () => {
    const first = replay(moves, 1);
    expect(first).not.toBeNull();
    expect(first?.round).toBe(1);
    expect(first?.frames).toHaveLength((first?.moves.length ?? 0) + 1);
    // 4 bids and 52 cards played.
    expect(first?.moves.filter((m) => m.type === 'playToTrick')).toHaveLength(52);
    expect(first?.trickZones).toEqual(['trick']);
    // The second round's moves follow straight on from the first's.
    const second = replay(moves, 2);
    expect([...(first?.moves ?? []), ...(second?.moves ?? [])]).toEqual(moves);
    expect(second?.dealer).toBe(state.history[1]?.dealer);
  });

  it('shows every hand face up after the deal, and the round as it ended', () => {
    const { frames = [] } = replay(moves, 1) ?? {};
    const hands = Object.entries(frames[0]?.zones ?? {}).filter(([key]) => key.startsWith('hand@'));
    expect(hands).toHaveLength(4);
    for (const [, zone] of hands) {
      expect(zone.kind).toBe('cards');
      expect(zone.kind === 'cards' && zone.cards).toHaveLength(13);
    }
    const end = frames[frames.length - 1];
    expect(end?.players.reduce((sum, p) => sum + p.tricks, 0)).toBe(13);
    expect(end?.teams.map((t) => t.score)).toEqual(state.history[0]?.teams.map((t) => t.score));
  });

  it('shows every card of a trick as it is played', () => {
    const { frames = [], moves: played = [] } = replay(moves, 1) ?? {};
    const firstPlay = played.findIndex((m) => m.type === 'playToTrick');
    const trick = frames[firstPlay + 1]?.trick;
    expect(trick?.plays).toHaveLength(1);
    expect(trick?.plays[0]?.card).not.toBeNull();
    expect(trick?.led).not.toBeNull();
  });

  it('gives nothing for a round still being played, or not reached', () => {
    const midway = play(spades, 'replay', (s) => s.round === 2 && s.log.length > s.roundStart + 6);
    expect(replay(midway.moves, 1)).not.toBeNull();
    expect(replay(midway.moves, 2)).toBeNull();
    expect(replay(midway.moves, 3)).toBeNull();
    expect(replay([], 1)).toBeNull();
  });

  it('gives nothing for a round whose last move has not been made', () => {
    const almost = moves.slice(0, (replay(moves, 1)?.moves.length ?? 0) - 1);
    expect(replay(almost, 1)).toBeNull();
  });

  it('plays back the last round of a game that is over', () => {
    const tiny = (() => {
      let s = createGame(tinyTricks, {}, 2, 'tiny');
      const log: Move[] = [];
      while (s.status !== 'over') {
        const move = getLegalMoves(s, playersToAct(s)[0] as number)[0] as Move;
        log.push(move);
        s = applyMove(s, move, { holdNextRound: true });
      }
      return log;
    })();
    const result = replayRound(tinyTricks, {}, 2, 'tiny', tiny, 1);
    expect(result?.moves).toEqual(tiny);
  });
});
