/**
 * Building blocks for games that score as cards are played (cribbage-style):
 * the `score` effect, ending the game the moment it's won, giving played
 * cards back, pattern counting, values shown on the table, result notes and
 * teams that depend on the player count.
 */
import { describe, expect, it } from 'vitest';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import { evaluate } from './expr/evaluate';
import { buildScope } from './game/scope';
import { teamsFor } from './game/setup';
import type { GameState } from './game/state';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';
import { counting } from './__fixtures__/games';
import { hand, id, play, withZones } from './testing';

const lateEnd: GameFile = {
  ...counting,
  endCondition: { ...counting.endCondition, immediate: false },
};

const put = (player: number, spec: string) => ({
  player,
  type: 'play' as const,
  card: id(spec),
  to: 'pile',
});
const count = (player: number) => ({ player, type: 'choose' as const, value: 'count' });

/** Two players: L (left of the dealer, plays first) holds 5H 5S 4C; the dealer D holds 5C 6D JS. */
function deal(file: GameFile, options = {}): { state: GameState; L: number; D: number } {
  const start = createGame(file, options, 2, 'counting');
  const L = start.cursor.current;
  const D = 1 - L;
  const state = withZones(
    start,
    { [`hand@${L}`]: ['5H', '5S', '4C'], [`hand@${D}`]: ['5C', '6D', 'JS'] },
    'stock',
  );
  return { state, L, D };
}

const playAll = (s: GameState, L: number, D: number) =>
  play(s, put(L, '5H'), put(D, '5C'), put(L, '5S'), put(D, '6D'), put(L, '4C'), put(D, 'JS'));

describe('scoring as cards are played', () => {
  it('scores straight away and notes each score for the log', () => {
    const { state, L, D } = deal(counting);
    const paired = play(state, put(L, '5H'), put(D, '5C'));
    expect(paired.teams[D]?.score).toBe(2);
    expect(paired.scoreEvents).toEqual([
      { round: 1, at: 2, player: D, team: D, points: 2, label: 'Pair', into: null },
    ]);

    const tripled = play(paired, put(L, '5S'));
    expect(tripled.teams[L]?.score).toBe(6);
    // 5H 5C 5S 6D 4C: the 4 makes a run of 4-5-6 with the cards on top.
    const run = play(tripled, put(D, '6D'), put(L, '4C'));
    expect(run.teams[L]?.score).toBe(9);
    expect(run.scoreEvents.at(-1)).toMatchObject({ player: L, points: 3, label: 'Run' });
  });

  it('gives each card back to the player who played it', () => {
    const { state, L, D } = deal(counting);
    const done = playAll(state, L, D);
    expect(done.zones.pile).toEqual([]);
    expect(hand(done, L)).toEqual([]);
    expect(done.zones[`played@${L}`]?.map((c) => c.id)).toEqual([id('5H'), id('5S'), id('4C')]);
    expect(done.zones[`played@${D}`]?.map((c) => c.id)).toEqual([id('5C'), id('6D'), id('JS')]);
  });

  it('counts patterns in a pile and skips scores of 0', () => {
    const { state, L, D } = deal(counting);
    const shown = play(playAll(state, L, D), count(L), count(D));
    // L's 5 5 4 has no fifteen; D's 5 6 J has 5+J and the jack of spades.
    expect(shown.scoreEvents.slice(-2)).toMatchObject([
      { player: D, points: 2, label: 'Fifteens' },
      { player: D, points: 1, label: 'Jack' },
    ]);
    // The round summary counts every point scored during the round.
    expect(shown.history[0]?.teams.map((t) => t.points)).toEqual(L === 0 ? [9, 5] : [5, 9]);
    expect(shown.round).toBe(2);
  });

  it('can read the patterns in expressions', () => {
    const { state, L, D } = deal(counting);
    const s = play(state, put(L, '5H'), put(D, '5C'));
    const at = (expr: string) => evaluate(expr, buildScope(s, { player: L }));
    expect(at('countPairs(pile, hand)')).toBe(3);
    expect(at('countPairs(hand.cards)')).toBe(0);
    expect(at('countSums(15, pile, hand)')).toBe(1);
    expect(at('runCards(pile, hand)')).toBe(0);
    expect(at('pile.sameRankAtEnd')).toBe(2);
    expect(at("hand.hasCard('5', 'spades')")).toBe(true);
    expect(at("hand.hasCard('5', 'hearts')")).toBe(false);
    expect(() => at('countPairs(3)')).toThrow('countPairs() needs piles or lists of cards');
    expect(() => at("countSums('x', pile)")).toThrow('countSums() needs a total first');
  });
});

describe('ending the game the moment it is won', () => {
  it('ends mid-round, skipping the rest, and records the round so far', () => {
    const { state, L, D } = deal(counting, { target: 5 });
    const over = play(state, put(L, '5H'), put(D, '5C'), put(L, '5S'));
    expect(over.status).toBe('over');
    expect(over.winners).toEqual([L]);
    expect(getLegalMoves(over, D)).toEqual([]);
    expect(over.history).toHaveLength(1);
    expect(over.history[0]?.teams.find((t) => t.id === L)?.points).toBe(6);
    expect(over.notes).toEqual([]);
    expect(() => applyMove(over, put(D, '6D'))).toThrow('The game is over');
  });

  it('adds the result notes that apply', () => {
    const { state, L, D } = deal(counting, { target: 2 });
    const over = play(state, put(L, '5H'), put(D, '5C'));
    expect(over.winners).toEqual([D]);
    expect(over.notes).toEqual(['Shutout!']);
    expect(viewFor(over, L).notes).toEqual(['Shutout!']);
  });

  it('waits for the end of the round without "immediate"', () => {
    const { state, L, D } = deal(lateEnd, { target: 5 });
    const played = playAll(state, L, D);
    expect(played.status).toBe('inProgress');
    const over = play(played, count(L), count(D));
    expect(over.status).toBe('over');
    expect(over.winners).toEqual([L]);
  });
});

describe('values shown on the table', () => {
  it('shows display values that are set', () => {
    const { state, L, D } = deal(counting);
    expect(viewFor(state, L).display).toEqual([]);
    const s = play(state, put(L, '5H'), put(D, '6D'));
    expect(viewFor(s, D).display).toEqual([{ label: 'Total', value: 11 }]);
  });
});

describe('teams by player count', () => {
  it('makes partnerships only for the listed player counts', () => {
    expect(createGame(counting, {}, 4, 't').teams.map((t) => t.players)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(createGame(counting, {}, 3, 't').teams.map((t) => t.players)).toEqual([[0], [1], [2]]);
    expect(teamsFor(counting, 2)).toBeNull();
    expect(teamsFor(counting, 4)).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });
});

describe('checking the new blocks', () => {
  const errors = (file: unknown) => {
    const result = validate(file);
    return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
  };
  const playEffects = (effects: unknown[]) => ({
    ...counting,
    phases: [
      { ...counting.phases[0], actions: [{ type: 'play', to: 'pile', effects }] },
      counting.phases[1],
    ],
  });

  it('accepts the counting game', () => {
    expect(errors(counting)).toEqual([]);
  });

  it('checks teams by player count', () => {
    expect(errors({ ...counting, meta: { ...counting.meta, teams: { '6': [[0, 1]] } } })).toContain(
      'meta.teams.6: This game is for 2 to 4 players',
    );
    expect(
      errors({ ...counting, meta: { ...counting.meta, teams: { '4': [[0, 1], [2]] } } }),
    ).toContain('meta.teams.4: Teams must list each seat 0 to 3 exactly once');
  });

  it('checks score and returnCards effects', () => {
    expect(errors(playEffects([{ label: 'Pair' }]))).toContain(
      'phases[0] ("play").actions[0].effects[0].label: "label" only goes with score',
    );
    expect(errors(playEffects([{ to: 'played', score: 1 }]))).toContain(
      'phases[0] ("play").actions[0].effects[0].to: "to" only goes with returnCards',
    );
    expect(errors(playEffects([{ score: 'pile.nope' }]))).toEqual([
      expect.stringContaining('A zone has no "nope"'),
    ]);
    expect(errors(playEffects([{ returnCards: 'played', to: 'pile' }]))).toEqual([
      'phases[0] ("play").actions[0].effects[0].returnCards: Zone "played" must be shared, not one per player',
      'phases[0] ("play").actions[0].effects[0].to: Zone "pile" must be a per-player zone ("per": "player")',
    ]);
    expect(errors(playEffects([{ score: "hand.hasCard('X', 'spades') ? 1 : 0" }]))).toEqual([
      expect.stringContaining('"X" isn\'t a rank'),
    ]);
  });

  it("doesn't allow score where there is no player", () => {
    const tricky = {
      ...counting,
      phases: [
        {
          name: 'tricks',
          actions: [{ type: 'playToTrick', to: 'pile' }],
          afterTrick: [{ resolveTrick: 'highestLed' }, { score: 1 }],
        },
      ],
    };
    expect(errors(tricky)).toContain(
      `phases[0] ("tricks").afterTrick[1]: score needs a player to score for: use it in an action's effects`,
    );
  });

  it('keeps display values to public values', () => {
    expect(
      errors({
        ...counting,
        display: [{ label: 'Top', value: 'stock.top.rank', if: 'round > 1' }],
      }),
    ).toEqual([
      'display[0].value: A display can only use state, options and round (so it never shows ' +
        'hidden cards), not "stock"',
    ]);
    expect(
      errors({
        ...counting,
        endCondition: { ...counting.endCondition, notes: [{ if: 'nope', text: 'x' }] },
      }),
    ).toEqual([expect.stringContaining('Unknown name "nope"')]);
  });
});

describe('reading quantifiers', () => {
  it('warns that "!anyPlayer.x" means "some player isn\'t x"', () => {
    const file = {
      ...counting,
      phases: [{ ...counting.phases[0], until: '!anyPlayer.hasLegalPlay' }, counting.phases[1]],
    };
    const result = validate(file);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.message)).toEqual([
      '"!anyPlayer…" in "!anyPlayer.hasLegalPlay" means "some player doesn\'t…", because ' +
        'anyPlayer applies to the whole expression. For "none", write "everyPlayer.… == false"',
    ]);
  });
});
