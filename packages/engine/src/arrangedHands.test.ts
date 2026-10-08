/**
 * Building blocks added for rummy and gin but meant for any game: hands the
 * players arrange themselves, "Sort into melds", melding from groups, wild
 * cards, going out by showing your hand, per-player values, several starting
 * flips, joker counts as expressions and end-of-game scoring.
 */
import { describe, expect, it } from 'vitest';
import { wildRummy } from './__fixtures__/games';
import { hand, id, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import { IllegalMoveError } from './errors';
import type { GameState } from './game/state';
import type { Move } from './game/move';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';

type Options = Record<string, boolean>;

/** The first player (a) and b hold these cards; the cut rank is set to `cutRank`. */
function table(a: string[], b: string[], options: Options = {}, cutRank: string | null = null) {
  const base = createGame(wildRummy, options, 2, 'wild');
  const A = base.cursor.current;
  const B = 1 - A;
  const state = withZones(base, { [`hand@${A}`]: a, [`hand@${B}`]: b }, 'stock');
  state.vars.cutRank = cutRank;
  return { state, A, B };
}
const joker = (n: number) => `JOKER.${n}`;
const arrange = (player: number, ...groups: string[][]): Move => ({
  player,
  type: 'arrange',
  groups: groups.map((g) => g.map((c) => (c.startsWith('JOKER') ? c : id(c)))),
});
const draw = (player: number, from = 'stock'): Move => ({ player, type: 'draw', from });
const types = (state: GameState, seat: number) =>
  [...new Set(getLegalMoves(state, seat).map((m) => m.type))].sort();

describe('several starting flips and joker counts', () => {
  it('turns the upcard and the cut joker, and sets the wild rank', () => {
    const state = createGame(wildRummy, {}, 2, 'flips');
    expect(state.zones.discard).toHaveLength(1);
    expect(state.zones.cut).toHaveLength(1);
    const cut = state.zones.cut?.[0];
    expect(state.vars.cutRank).toBe(cut && 'rank' in cut ? cut.rank : 'A');
    expect(Object.values(state.zones).flat()).toHaveLength(54);
  });

  it('skips a flip whose "if" is false, and leaves jokers out by expression', () => {
    const state = createGame(wildRummy, { cut: false, jokers: false }, 2, 'flips');
    expect(state.zones.cut).toHaveLength(0);
    expect(state.vars.cutRank).toBeUndefined();
    expect(Object.values(state.zones).flat()).toHaveLength(52);
  });
});

describe('arranging your hand', () => {
  it('is free, any time, and checked as it arrives', () => {
    const { state, A, B } = table(['3H', '4H', '5H', '9C'], ['2D', '7S', '8S']);
    // B arranges while it's A's turn; the turn doesn't change.
    const arranged = applyMove(state, arrange(B, ['7S', '8S']));
    expect(arranged.cursor.current).toBe(A);
    expect(arranged.players[B]?.groups).toEqual([[id('7S'), id('8S')]]);
    expect(() => applyMove(state, arrange(B, ['3H']))).toThrow(IllegalMoveError);
    expect(() => applyMove(state, arrange(B, ['7S'], ['7S']))).toThrow(/two groups/);
    // Arrangements aren't among the legal moves.
    expect(getLegalMoves(state, B).some((m) => m.type === 'arrange')).toBe(false);
  });

  it('shows you your groups, whether each is a meld, and your deadwood', () => {
    const { state, A, B } = table(['3H', '4H', '5H', '9C', 'KC'], ['2D', '7S']);
    const arranged = applyMove(state, arrange(A, ['3H', '4H', '5H'], ['9C', 'KC']));
    expect(viewFor(arranged, A).arrangement).toEqual({
      groups: [
        { cards: [id('3H'), id('4H'), id('5H')], kind: 'run', pure: true },
        { cards: [id('9C'), id('KC')], kind: null, pure: false },
      ],
      deadwood: 19,
    });
    // Nobody else sees your groups, or which cards your arrange move used.
    expect(JSON.stringify(viewFor(arranged, B))).not.toContain(id('3H'));
    expect(viewFor(arranged, B).log.at(-1)).toEqual({ player: A, type: 'arrange', hidden: true });
  });

  it('counts every card when the pure-run rule isn’t met', () => {
    const { state, A } = table(['3H', joker(0), '5H', '9C'], ['2D']);
    const arranged = applyMove(state, arrange(A, ['3H', joker(0), '5H']));
    expect(viewFor(arranged, A).arrangement?.deadwood).toBe(17);
    const relaxed = table(['3H', joker(0), '5H', '9C'], ['2D'], { pure: false });
    const ok = applyMove(relaxed.state, arrange(relaxed.A, ['3H', joker(0), '5H']));
    expect(viewFor(ok, relaxed.A).arrangement?.deadwood).toBe(9);
  });

  it('offers "Sort into melds", unless the house rule switches it off', () => {
    const { state, A } = table(['3H', '4H', '5H', '9C', '9D', '9S', 'KC'], ['2D']);
    expect(getLegalMoves(state, A)).toContainEqual({ player: A, type: 'sortHand' });
    const sorted = applyMove(state, { player: A, type: 'sortHand' });
    expect(viewFor(sorted, A).arrangement?.deadwood).toBe(10);
    const off = table(['3H', '4H', '5H'], ['2D'], { sort: false });
    expect(getLegalMoves(off.state, off.A).some((m) => m.type === 'sortHand')).toBe(false);
    expect(() => applyMove(off.state, { player: off.A, type: 'sortHand' })).toThrow();
  });
});

describe('melding from your groups, with wild cards', () => {
  it('offers each valid group, and a joker meld only after a pure run', () => {
    const { state, A } = table(
      ['3H', '4H', '5H', '9C', '9D', joker(0), 'KC'],
      ['2D', '7S'],
      {},
      null,
    );
    const drawn = applyMove(
      applyMove(state, arrange(A, ['9C', '9D', joker(0)], ['3H', '4H', '5H'])),
      draw(A),
    );
    const melds = getLegalMoves(drawn, A).filter((m) => m.type === 'meld');
    expect(melds).toEqual([
      { player: A, type: 'meld', cards: [id('3H'), id('4H'), id('5H')].sort() },
    ]);
    const pure = applyMove(drawn, melds[0] as Move);
    expect(getLegalMoves(pure, A).filter((m) => m.type === 'meld')).toEqual([
      { player: A, type: 'meld', cards: [id('9C'), id('9D'), joker(0)].sort() },
    ]);
  });

  it('treats the cut rank as wild, and lays wild cards off onto melds', () => {
    const { state, A } = table(['3H', '4H', '5H', '7C', 'KC'], ['2D'], {}, '7');
    const ready = applyMove(applyMove(state, arrange(A, ['3H', '4H', '5H'])), draw(A));
    const melded = applyMove(ready, {
      player: A,
      type: 'meld',
      cards: [id('3H'), id('4H'), id('5H')].sort(),
    });
    // The 7♣ is wild (sevens are cut), so it can extend the run.
    expect(getLegalMoves(melded, A)).toContainEqual({
      player: A,
      type: 'layOff',
      card: id('7C'),
      meld: { zone: `melds@${A}`, index: 0 },
    });
  });
});

describe('drawn cards and per-player values', () => {
  it('remembers the card taken from the discard pile so it can’t go straight back', () => {
    const { state, A } = table(['3H', '9C'], ['2D']);
    const top = state.zones.discard?.at(-1)?.id as string;
    const taken = applyMove(state, draw(A, 'discard'));
    expect(taken.players[A]?.vars.taken).toBe(top);
    const discards = getLegalMoves(taken, A).filter((m) => m.type === 'discard');
    expect(discards.map((m) => (m.type === 'discard' ? m.card : '')).sort()).toEqual(
      [id('3H'), id('9C')].sort(),
    );
  });

  it('keeps custom values per player', () => {
    const { state, A, B } = table(['3H', '4H', '5H', '9C', 'KC'], ['2D', '8S']);
    let s = applyMove(applyMove(state, arrange(A, ['3H', '4H', '5H'])), draw(A));
    s = applyMove(s, { player: A, type: 'meld', cards: [id('3H'), id('4H'), id('5H')].sort() });
    s = applyMove(s, { player: A, type: 'discard', card: id('9C'), to: 'discard' });
    expect(s.players[A]?.vars.hasMelded).toBe(true);
    expect(s.players[B]?.vars.hasMelded).toBeUndefined();
    s = applyMove(applyMove(s, draw(B)), {
      player: B,
      type: 'discard',
      card: id('8S'),
      to: 'discard',
    });
    expect(s.players[B]?.vars.hasMelded).toBe(false);
  });
});

describe('going out by showing your hand', () => {
  it('is allowed only when every other card is in a valid group (with a pure run)', () => {
    const { state, A } = table(['3H', '4H', '5H', '9C', '9D', joker(0)], ['2D', 'KS']);
    const drawn = applyMove(state, draw(A));
    const extra = hand(drawn, A).find(
      (c) => ![id('3H'), id('4H'), id('5H'), id('9C'), id('9D'), joker(0)].includes(c),
    ) as string;
    expect(types(drawn, A)).not.toContain('showHand');
    const grouped = applyMove(drawn, arrange(A, ['3H', '4H', '5H'], ['9C', '9D', joker(0)]));
    expect(getLegalMoves(grouped, A).filter((m) => m.type === 'showHand')).toEqual([
      { player: A, type: 'showHand', card: extra, to: 'discard' },
    ]);
  });

  it('lays out the melds, lets the others show their hands, then scores deadwood', () => {
    const { state, A, B } = table(
      ['3H', '4H', '5H', '9C', '9D', joker(0)],
      ['2D', '3D', '4D', 'KS'],
    );
    const drawn = applyMove(state, draw(A));
    const grouped = applyMove(drawn, arrange(A, ['3H', '4H', '5H'], ['9C', '9D', joker(0)]));
    const out = applyMove(
      grouped,
      getLegalMoves(grouped, A).find((m) => m.type === 'showHand') as Move,
    );
    expect(out.melds[`melds@${A}`]).toHaveLength(2);
    expect(out.file.phases[out.cursor.phase]?.name).toBe('show');
    expect(out.cursor.current).toBe(B);
    // B groups 2-3-4♦ before showing: only the K♠ counts. Then the game-end bonus applies.
    const shown = applyMove(applyMove(out, arrange(B, ['2D', '3D', '4D'])), {
      player: B,
      type: 'choose',
      value: 'show',
    });
    expect(shown.status).toBe('over');
    expect(shown.teams[A]?.score).toBe(10 + 1000);
    expect(shown.teams[B]?.score).toBe(0);
  });
});

describe('end-of-game scoring', () => {
  it('is undone if a tie means the game goes on', () => {
    const file: GameFile = {
      ...wildRummy,
      scoring: { ...wildRummy.scoring, perPlayer: [], atGameEnd: [{ add: 5 }] },
    };
    const base = createGame(file, {}, 2, 'tie');
    const A = base.cursor.current;
    const state = withZones(base, { [`hand@${A}`]: ['3H'], [`hand@${1 - A}`]: ['2D'] }, 'stock');
    // Both 0: a tie, so play goes on and the +5 bonus is undone.
    const out = applyMove(applyMove(state, draw(A)), {
      player: A,
      type: 'discard',
      card: id('3H'),
      to: 'discard',
    });
    expect(out.status).toBe('inProgress');
    expect(out.teams.map((t) => t.score)).toEqual([0, 0]);
  });
});

describe('validating the new parts', () => {
  it('reports mistakes clearly', () => {
    const result = validate({
      ...wildRummy,
      meldRules: { aces: 'sideways', zone: 'discard' },
      cardOrder: { wild: 'card.colour == 1' },
      phases: [
        {
          ...wildRummy.phases[0]!,
          turn: [
            {
              actions: [
                { type: 'draw', from: 'stock', effects: [{ set: { 'player.score': 1 } }] },
                { type: 'meld', to: 'melds', if: 'meld.colour' },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      'cardOrder.wild',
      'meldRules.aces',
      'meldRules.zone', // not one per player
      'meldRules.zone', // doesn't hold melds
      'phases[0] ("play").turn[0].actions[0].effects[0].set.player.score',
      'phases[0] ("play").turn[0].actions[1].if',
    ]);
  });
});
