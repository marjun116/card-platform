import { describe, expect, it } from 'vitest';
import { sevensUp, spades, tinyTricks } from '../__fixtures__/games';
import { createGame } from '../api';
import { GameFileError, SetupError } from '../errors';
import type { GameFile } from './types';

describe('createGame', () => {
  it('deals 13 cards to each spades player', () => {
    const state = createGame(spades, {}, 4, 'deal');
    for (let seat = 0; seat < 4; seat++) expect(state.zones[`hand@${seat}`]).toHaveLength(13);
    expect(state.zones.trick).toEqual([]);
    expect(state.zones['won@t0']).toEqual([]);
    expect(state.zones['won@t1']).toEqual([]);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = createGame(spades, {}, 4, 'same');
    const b = createGame(spades, {}, 4, 'same');
    const c = createGame(spades, {}, 4, 'other');
    expect(a.zones).toEqual(b.zones);
    expect(a.dealer).toBe(b.dealer);
    expect(a.zones).not.toEqual(c.zones);
  });

  it('picks the first dealer from the seed', () => {
    const dealers = new Set(
      Array.from({ length: 20 }, (_, i) => createGame(spades, {}, 4, `d${i}`).dealer),
    );
    expect(dealers.size).toBeGreaterThan(1);
  });

  it('deals starting left of the dealer, one card at a time', () => {
    // No shuffle: the deck is 2H 3H 4H 5H 2S 3S 4S 5S and dealing takes from the end.
    const state = createGame(tinyTricks, {}, 2, 'x');
    const left = (state.dealer + 1) % 2;
    expect(state.zones[`hand@${left}`]?.map((c) => c.id)).toEqual(['5S.0', '3S.0', '5H.0', '3H.0']);
    expect(state.zones[`hand@${state.dealer}`]?.map((c) => c.id)).toEqual([
      '4S.0',
      '2S.0',
      '4H.0',
      '2H.0',
    ]);
  });

  it('puts the rest in the stock and flips the starting card', () => {
    const state = createGame(sevensUp, {}, 3, 'flip');
    expect(state.zones.stock).toHaveLength(52 - 21 - 1);
    expect(state.zones.discard).toHaveLength(1);
    const top = state.zones.discard?.[0];
    expect(top && 'suit' in top ? top.suit : null).toBe(state.vars.activeSuit);
  });

  it('builds teams from meta.teams, or one team per player', () => {
    const team = createGame(spades, {}, 4, 't');
    expect(team.teams.map((t) => t.players)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(team.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    const solo = createGame(sevensUp, {}, 3, 't');
    expect(solo.teams.map((t) => t.players)).toEqual([[0], [1], [2]]);
  });

  it('fills in option defaults and accepts valid choices', () => {
    expect(createGame(spades, {}, 4, 'o').options).toEqual({
      nil: true,
      blindNil: false,
      targetScore: 500,
      mercyRule: true,
    });
    expect(createGame(spades, { targetScore: 300 }, 4, 'o').options.targetScore).toBe(300);
  });

  it.each([
    [{ targetScore: 400 }, 'must be one of 300, 500, 1000'],
    [{ blindNil: 'yes' }, 'must be true or false'],
    [{ jokers: true }, 'Unknown option "jokers"'],
  ])('rejects bad options %o', (options, message) => {
    expect(() => createGame(spades, options, 4, 'o')).toThrow(SetupError);
    expect(() => createGame(spades, options, 4, 'o')).toThrow(message);
  });

  it('checks the player count', () => {
    expect(() => createGame(spades, {}, 3, 'p')).toThrow('needs exactly 4 players (got 3)');
    expect(() => createGame(sevensUp, {}, 7, 'p')).toThrow('needs 2 to 6 players (got 7)');
    expect(() => createGame(sevensUp, {}, 2.5, 'p')).toThrow(SetupError);
  });

  it('rejects teams that do not cover each seat once', () => {
    const bad: GameFile = {
      ...spades,
      meta: {
        ...spades.meta,
        teams: [
          [0, 1],
          [1, 3],
        ],
      },
    };
    expect(() => createGame(bad, {}, 4, 'p')).toThrow('each seat 0 to 3 exactly once');
  });

  it('rejects a deal larger than the deck', () => {
    const bad: GameFile = {
      ...spades,
      setup: { ...spades.setup, deal: { to: 'hand', count: 14 } },
    };
    expect(() => createGame(bad, {}, 4, 'p')).toThrow(GameFileError);
  });

  it('notices when a game uses blind bids', () => {
    expect(createGame(spades, {}, 4, 'b').lookRequired).toBe(true);
    expect(createGame(sevensUp, {}, 4, 'b').lookRequired).toBe(false);
  });
});
