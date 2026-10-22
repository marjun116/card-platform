/**
 * Big moments (`moments` in a game file): a banner everyone sees when a
 * condition turns true (`when`) or a number goes up (`each`), for the table or
 * for each player or team (`per`). Only public values may be used.
 */
import { describe, expect, it } from 'vitest';
import { counting } from './__fixtures__/games';
import { applyMove, createGame, viewFor } from './api';
import type { GameState } from './game/state';
import type { GameFile, MomentDef } from './game/types';
import { validate } from './schema/validate';
import { withZones } from './testing';

const withMoments = (...moments: MomentDef[]): GameFile => ({ ...counting, moments });

/** Two players: the first to play holds 5H 6H 7H, the other 5C 6D JS. */
function start(file: GameFile) {
  const state = createGame(file, {}, 2, 'moments');
  const first = state.cursor.current;
  const other = 1 - first;
  const dealt = withZones(
    state,
    { [`hand@${first}`]: ['5H', '6H', '7H'], [`hand@${other}`]: ['5C', '6D', 'JS'] },
    'stock',
  );
  const play = (s: GameState, player: number, card: string) =>
    applyMove(s, { player, type: 'play', card, to: 'pile' });
  return { state: dealt, first, other, play };
}

const labels = (state: GameState) => state.moments.map((m) => m.label);

const errors = (file: GameFile) => {
  const result = validate(file);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
};

describe('moments', () => {
  it('happens once when its condition turns true, not again while it stays true', () => {
    const { state, first, other, play } = start(
      withMoments({ when: 'state.total != null && state.total >= 10', label: 'Ten!' }),
    );
    const one = play(state, first, '5H.0');
    expect(one.moments).toEqual([]);
    const two = play(one, other, '5C.0');
    expect(two.moments).toEqual([
      { round: 1, at: two.log.length, label: 'Ten!', player: null, team: null },
    ]);
    const three = play(two, first, '6H.0');
    expect(labels(three)).toEqual(['Ten!']);
  });

  it('happens each time an "each" number goes up', () => {
    const { state, first, other, play } = start(withMoments({ each: 'pile.count', label: 'Card' }));
    const after = play(play(play(state, first, '5H.0'), other, '5C.0'), first, '6H.0');
    expect(labels(after)).toEqual(['Card', 'Card', 'Card']);
  });

  it('with "per", is read for each player and says whose moment it is', () => {
    const file = withMoments({ per: 'player', each: 'player.score', label: 'Scored' });
    const { state, first, other, play } = start(file);
    // The second 5 makes a pair, for the player who played it.
    const after = play(play(state, first, '5H.0'), other, '5C.0');
    const team = after.players[other]?.team;
    expect(after.moments).toEqual([
      { round: 1, at: after.log.length, label: 'Scored', player: other, team },
    ]);
  });

  it('with "per": "team", says which team', () => {
    const file = withMoments({ per: 'team', when: 'team.score > 0', label: 'On the board' });
    const { state, first, other, play } = start(file);
    const after = play(play(state, first, '5H.0'), other, '5C.0');
    const team = after.players[other]?.team ?? -1;
    expect(after.moments).toMatchObject([{ label: 'On the board', player: null, team }]);
  });

  it("is in every player's view", () => {
    const { state, first, other, play } = start(
      withMoments({ when: 'state.total != null && state.total >= 10', label: 'Ten!' }),
    );
    const after = play(play(state, first, '5H.0'), other, '5C.0');
    expect(viewFor(after, first).moments).toEqual(after.moments);
    expect(viewFor(after, other).moments).toEqual(after.moments);
  });

  it('can happen again in a later round, once its value has reset', () => {
    const file = withMoments({ when: 'state.total != null && state.total >= 10', label: 'Ten!' });
    let state = createGame(file, {}, 2, 'moments-rounds');
    for (let i = 0; i < 200 && state.round < 3 && state.status !== 'over'; i++) {
      const seat = state.pending?.player ?? state.cursor.current;
      const hand = state.zones[`hand@${seat}`] ?? [];
      const card = hand[0];
      state = card
        ? applyMove(state, { player: seat, type: 'play', card: card.id, to: 'pile' })
        : applyMove(state, { player: seat, type: 'choose', value: 'count' });
    }
    // At most once a round (state.total stays at 10 or more once there), and in more than one.
    const rounds = new Set(state.moments.map((m) => m.round));
    expect(state.moments.length).toBe(rounds.size);
    expect(rounds.size).toBeGreaterThan(1);
  });

  it("hasn't happened while it can't be worked out (a value not set yet)", () => {
    // "state.total" is null until the first card: no error, and no moment.
    const { state, first, other, play } = start(
      withMoments({ when: 'state.total >= 10', label: 'Ten!' }),
    );
    expect(labels(play(play(state, first, '5H.0'), other, '5C.0'))).toEqual(['Ten!']);
  });

  it('does nothing in a game without moments', () => {
    const { state, first, play } = start(counting);
    expect(play(state, first, '5H.0').moments).toEqual([]);
  });
});

describe('validating moments', () => {
  it('accepts moments that use only what everyone can see', () => {
    expect(
      errors(
        withMoments(
          { when: 'state.total >= 15 && round > 1', label: 'Fifteen' },
          { each: 'pile.count', label: 'Cards' },
          {
            per: 'player',
            when: 'player.hand.count == 0 && player.played.count > 2',
            label: 'Out',
          },
          { per: 'team', each: 'team.score', label: 'Points' },
          { when: "anyPlayer.score > 10 && pile.hasCard('QS')", label: 'Queen' },
        ),
      ),
    ).toEqual([]);
  });

  it('rejects moments that read hidden cards or hidden values', () => {
    const problems = errors(
      withMoments(
        { per: 'player', when: "player.hand.hasCard('QS')", label: 'Has the queen' },
        { when: "holderOf('QS') == 0", label: 'Queen' },
        { per: 'player', when: 'player.hasLegalPlay', label: 'Can play' },
        { when: "stock.top.rank == 'A'", label: 'Ace next' },
      ),
    );
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('moments[0].when');
    expect(problems[0]).toContain('"player.hand.hasCard"');
    expect(problems[1]).toContain('"holderOf"');
    expect(problems[2]).toContain('"player.hasLegalPlay"');
    expect(problems[3]).toContain('"stock.top"');
  });

  it('rejects a count nobody is shown', () => {
    // counting's stock has no countVisible.
    expect(errors(withMoments({ each: 'stock.count', label: 'Stock' }))).toEqual([
      expect.stringContaining('not "stock.count"'),
    ]);
  });

  it('needs exactly one of "when" and "each"', () => {
    expect(errors(withMoments({ label: 'Nothing' }))).toEqual([
      expect.stringContaining('needs either "when"'),
    ]);
    expect(errors(withMoments({ when: 'round > 1', each: 'round', label: 'Both' }))).toEqual([
      expect.stringContaining('needs either "when"'),
    ]);
  });

  it('only has a player or team with "per"', () => {
    expect(errors(withMoments({ when: 'player.score > 5', label: 'Five' }))).toEqual([
      expect.stringContaining('"player" isn\'t available here'),
    ]);
  });
});
