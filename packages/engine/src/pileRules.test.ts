/**
 * Building blocks added for crazy eights but meant for any game: deck copies
 * that depend on the table, re-turning the starting card, per-player values,
 * draw counts as expressions, turn.draws, switchable whenEmpty rules, and a
 * winner that house rules can change.
 */
import { describe, expect, it } from 'vitest';
import { tinyTricks } from './__fixtures__/games';
import { hand, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves } from './api';
import { evaluate } from './expr/evaluate';
import { buildScope } from './game/scope';
import type { GameState } from './game/state';
import type { Move } from './game/move';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';

/**
 * Draw up to twice, then play any card. The next player draws `state.extra`
 * cards after each play (none unless set), and the round ends when a hand is empty.
 */
const shedding: GameFile = {
  meta: { name: 'Shedding', players: [2, 3] },
  deck: { copies: 'activePlayers.count == 3 ? 2 : 1' },
  options: {
    reshuffle: { label: 'Reshuffle', type: 'boolean', default: false },
    lowWins: { label: 'Lowest wins', type: 'boolean', default: false },
  },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    stock: { shared: true, visibility: 'none', countVisible: true },
    discard: { shared: true, visibility: 'topCardOnly' },
  },
  setup: { deal: { to: 'hand', count: 3 }, rest: 'stock', flip: { from: 'stock', to: 'discard' } },
  phases: [
    {
      name: 'play',
      until: 'anyPlayer.hand.count == 0',
      turn: [
        {
          optional: true,
          repeatable: true,
          actions: [{ type: 'draw', from: 'stock', if: 'turn.draws < 2' }],
        },
        {
          actions: [
            {
              type: 'play',
              to: 'discard',
              effects: [{ if: 'state.extra != null', nextPlayer: { draw: 'state.extra' } }],
            },
          ],
        },
      ],
      whenEmpty: { stock: { policy: 'reshuffleDiscardExceptTop', if: 'options.reshuffle' } },
    },
  ],
  scoring: {
    playerValues: { handValue: 'sum(player.hand, cardValue)' },
    perPlayer: [
      { if: 'player.hand.count == 0', add: 'sum(activePlayers, handValue)' },
      { if: 'handValue(player) == max(activePlayers, handValue)', add: -1 },
    ],
  },
  endCondition: {
    when: 'true',
    winner: "options.lowWins ? 'lowestScore' : 'highestScore'",
    ties: 'share',
  },
};

const draw = (player: number): Move => ({ player, type: 'draw', from: 'stock' });
const types = (moves: Move[]) => [...new Set(moves.map((m) => m.type))].sort();
const totalCards = (state: GameState) =>
  Object.values(state.zones).reduce((n, cards) => n + cards.length, 0);

describe('deck copies that depend on the table', () => {
  it('uses one deck for two players and two for three', () => {
    expect(totalCards(createGame(shedding, {}, 2, 'copies'))).toBe(52);
    expect(totalCards(createGame(shedding, {}, 3, 'copies'))).toBe(104);
  });

  it('checks the expression', () => {
    const result = validate({ ...shedding, deck: { copies: 'players.count' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.path)).toEqual(['deck.copies']);
  });
});

describe('re-turning the starting card', () => {
  const file = (reflipIf: string): GameFile => ({
    ...shedding,
    setup: { ...shedding.setup, flip: { from: 'stock', to: 'discard', reflipIf } },
  });

  it('buries matching cards in the stock and turns the next one', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const state = createGame(file("card.suit == 'spades'"), {}, 2, seed);
      const top = state.zones.discard?.at(-1);
      expect(top && 'suit' in top ? top.suit : null).not.toBe('spades');
      expect(state.zones.discard).toHaveLength(1);
      expect(totalCards(state)).toBe(52);
    }
  });

  it('keeps the last card turned if every card matches', () => {
    const state = createGame(file('true'), {}, 2, 'all');
    expect(state.zones.discard).toHaveLength(1);
    expect(totalCards(state)).toBe(52);
  });
});

describe('per-player values', () => {
  it('works a value out for any player and adds it up across players', () => {
    const base = createGame(shedding, {}, 2, 'values');
    const state = withZones(base, { 'hand@0': ['KH', '2S'], 'hand@1': ['5D'] }, 'stock');
    const ask = (expr: string) => evaluate(expr, buildScope(state, { player: 0 }));
    expect(ask('handValue(player)')).toBe(15); // K = 13 by rank number, plus 2
    expect(ask('sum(activePlayers, handValue)')).toBe(20);
    expect(ask('min(activePlayers, handValue)')).toBe(5);
  });

  it('scores everyone else’s cards to the player who went out', () => {
    const base = createGame(shedding, {}, 2, 'values');
    const first = base.cursor.current;
    const other = 1 - first;
    const state = withZones(
      base,
      { [`hand@${first}`]: ['3C'], [`hand@${other}`]: ['4D', '6D'] },
      'stock',
    );
    const after = applyMove(state, { player: first, type: 'play', card: '3C.0', to: 'discard' });
    expect(after.teams[first]?.score).toBe(10);
    expect(after.teams[other]?.score).toBe(-1); // the largest hand loses a point
  });

  it("checks player values: names can't clash or use each other", () => {
    const result = validate({
      ...shedding,
      scoring: {
        ...shedding.scoring,
        playerValues: {
          ...shedding.scoring.playerValues,
          hand: '1',
          a: 'b(player)',
          b: 'player.score',
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      'scoring.playerValues.hand: "hand" is already the name of something else',
      "scoring.playerValues.a: A player value can't use another player value",
    ]);
  });
});

describe('draw counts and turn.draws', () => {
  it('lets a player draw while turn.draws allows, then only play', () => {
    const state = createGame(shedding, {}, 2, 'draws');
    const p = state.cursor.current;
    const twice = play(state, draw(p), draw(p));
    expect(twice.cursor.draws).toBe(2);
    expect(types(getLegalMoves(twice, p))).toEqual(['play']);
    // The count starts again on the next player's turn.
    const card = hand(twice, p)[0] as string;
    const next = applyMove(twice, { player: p, type: 'play', card, to: 'discard' });
    expect(next.cursor.draws).toBe(0);
    expect(types(getLegalMoves(next, 1 - p))).toContain('draw');
  });

  it('works out how many cards to draw from an expression', () => {
    const [phase] = shedding.phases;
    const drawRoundPlusOne: GameFile = {
      ...shedding,
      phases: [
        {
          ...phase!,
          turn: [
            {
              optional: true,
              actions: [{ type: 'draw', from: 'stock', count: 'round + 1' }],
            },
            phase!.turn![1]!,
          ],
        },
      ],
    };
    const state = createGame(drawRoundPlusOne, {}, 2, 'count');
    const p = state.cursor.current;
    const drawn = applyMove(state, draw(p));
    expect(hand(drawn, p)).toHaveLength(5); // 3 dealt + 2 drawn in round 1
    expect(drawn.cursor.draws).toBe(2);
  });

  it('makes the next player draw a number of cards from an expression', () => {
    const base = createGame(shedding, {}, 2, 'count');
    const p = base.cursor.current;
    const extra = withZones(base, {}, 'stock');
    extra.vars.extra = 3;
    const before = hand(extra, 1 - p).length;
    const card = hand(extra, p)[0] as string;
    const after = applyMove(extra, { player: p, type: 'play', card, to: 'discard' });
    expect(hand(after, 1 - p)).toHaveLength(before + 3);

    // A count that isn't a whole number of cards is a mistake in the game file.
    extra.vars.extra = -1;
    expect(() => applyMove(extra, { player: p, type: 'play', card, to: 'discard' })).toThrow(
      /whole number, 0 or more \(got -1\)/,
    );
  });

  it('checks count expressions', () => {
    const result = validate({
      ...shedding,
      phases: [
        {
          ...shedding.phases[0]!,
          turn: undefined,
          actions: [
            { type: 'draw', from: 'stock', count: 'state.' },
            { type: 'play', to: 'discard', effects: [{ nextPlayer: { draw: 'nobody' } }] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      'phases[0] ("play").actions[0].count',
      'phases[0] ("play").actions[1].effects[0].nextPlayer.draw',
    ]);
  });
});

describe('switching a whenEmpty rule with a house rule', () => {
  const emptyStock = (options: Record<string, boolean>) => {
    const base = createGame(shedding, options, 2, 'empty');
    return withZones(base, { stock: [] }, 'discard');
  };

  it('reshuffles only when the rule is switched on', () => {
    const off = emptyStock({});
    expect(types(getLegalMoves(off, off.cursor.current))).toEqual(['play']);
    const on = emptyStock({ reshuffle: true });
    const p = on.cursor.current;
    expect(types(getLegalMoves(on, p))).toContain('draw');
    const drawn = applyMove(on, draw(p));
    expect(drawn.zones.discard).toHaveLength(1);
    expect(drawn.status).toBe('inProgress');
  });
});

describe('a winner that house rules can change', () => {
  const finish = (options: Record<string, boolean>) => {
    const base = createGame(shedding, options, 2, 'winner');
    const p = base.cursor.current;
    const state = withZones(base, { [`hand@${p}`]: ['3C'], [`hand@${1 - p}`]: ['4D'] }, 'stock');
    return { state: applyMove(state, { player: p, type: 'play', card: '3C.0', to: 'discard' }), p };
  };

  it('picks the highest or lowest score as the option says', () => {
    const high = finish({});
    expect(high.state.winners).toEqual([high.p]);
    const low = finish({ lowWins: true });
    expect(low.state.winners).toEqual([1 - low.p]);
  });

  it('checks the expression', () => {
    const result = validate({ ...tinyTricks, endCondition: { when: 'true', winner: 'best' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.path)).toEqual(['endCondition.winner']);
  });
});
