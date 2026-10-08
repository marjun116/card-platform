/**
 * Scenario tests for gin-rummy.json: the rules a real table would check.
 * Seat a is the non-dealer (who decides on the upcard first), b the dealer.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
} from '@card-table/engine';
import { draft, hand, id, play, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const gin = builtInGames['gin-rummy'];
type Options = Record<string, OptionValue>;

const ids = (...specs: string[]) => specs.map(id);
const types = (state: GameState, seat: number) =>
  [...new Set(getLegalMoves(state, seat).map((m) => m.type))].sort();
const phase = (state: GameState) => state.file.phases[state.cursor.phase]?.name;
const score = (state: GameState, seat: number) => state.teams[seat]?.score;

/** a and b hold these hands, with `top` face up; `stock` (last card drawn first) if given. */
function table(
  a: string[],
  b: string[],
  { options = {}, top = 'KD', stock }: { options?: Options; top?: string; stock?: string[] } = {},
) {
  const base = createGame(gin, options, 2, 'gin');
  const A = base.cursor.current;
  const B = 1 - A;
  const zones: Record<string, string[]> = { [`hand@${A}`]: a, [`hand@${B}`]: b, discard: [top] };
  if (stock) zones.stock = stock;
  return { state: withZones(base, zones, stock ? 'discard' : 'stock'), A, B };
}
const choose = (player: number, value: string): Move => ({ player, type: 'choose', value });
const draw = (player: number, from = 'stock'): Move => ({ player, type: 'draw', from });
const discard = (player: number, card: string): Move => ({
  player,
  type: 'discard',
  card: id(card),
  to: 'discard',
});
const arrange = (player: number, ...groups: string[][]): Move => ({
  player,
  type: 'arrange',
  groups: groups.map((g) => ids(...g)),
});
/** Both players pass on the upcard; the non-dealer then draws `card` from the stock and throws it away. */
const passAndCycle = (state: GameState, A: number, B: number, card: string) =>
  play(state, choose(A, 'pass'), choose(B, 'pass'), draw(A), discard(A, card));

// a's melds: 3-4-5♥, three 7s, three 9s.
const MELDS = ['3H', '4H', '5H', '7C', '7D', '7S', '9S', '9D', '9C'];
const arrangeA = (A: number) =>
  arrange(A, ['3H', '4H', '5H'], ['7C', '7D', '7S'], ['9S', '9D', '9C']);

describe('gin: the upcard', () => {
  it('lets the non-dealer, then the dealer, take it or pass', () => {
    const { state, A, B } = table(MELDS.concat('2D'), ['2C']);
    expect(phase(state)).toBe('upcard');
    expect(state.cursor.current).toBe(A);
    expect(getLegalMoves(state, A).map((m) => m.type)).toEqual(['draw', 'choose', 'sortHand']);
    const passed = applyMove(state, choose(A, 'pass'));
    expect(passed.cursor.current).toBe(B);
  });

  it("takes the upcard, which can't go straight back, then it's the other player's turn", () => {
    const { state, A, B } = table(MELDS.concat('2D'), ['2C'], { top: 'KD' });
    const took = applyMove(state, draw(A, 'discard'));
    const discards = getLegalMoves(took, A).flatMap((m) => (m.type === 'discard' ? [m.card] : []));
    expect(discards).not.toContain(id('KD'));
    // No knock is possible (deadwood 10 + 2), so the turn ends by itself after discarding.
    const after = applyMove(took, discard(A, '2D'));
    expect(phase(after)).toBe('play');
    expect(after.cursor.current).toBe(B);
  });

  it('makes the non-dealer draw from the stock when both pass', () => {
    const { state, A, B } = table(MELDS.concat('2D'), ['2C']);
    const passed = play(state, choose(A, 'pass'), choose(B, 'pass'));
    expect(phase(passed)).toBe('play');
    expect(passed.cursor.current).toBe(A);
    expect(getLegalMoves(passed, A).filter((m) => m.type === 'draw')).toEqual([draw(A)]);
  });
});

describe('gin: knocking', () => {
  const B_HAND = ['6H', 'JC', 'QC', 'KC', '2C', '8D', 'AS', '4S', '5S', '10D'];

  it('allows a knock with 10 or less deadwood, then the opponent lays off and scores are settled', () => {
    const { state, A, B } = table(MELDS.concat('2D'), B_HAND, { stock: ['8C', '8H', 'QS'] });
    let s = applyMove(state, arrangeA(A));
    s = passAndCycle(s, A, B, 'QS');
    expect(getLegalMoves(s, A)).toContainEqual(choose(A, 'knock'));
    s = applyMove(s, choose(A, 'knock'));
    // a's melds are on the table; b may lay the 6♥ off on 3-4-5♥, then shows.
    expect(s.melds[`melds@${A}`]).toHaveLength(3);
    expect(phase(s)).toBe('layOff');
    expect(s.cursor.current).toBe(B);
    const layOff = getLegalMoves(s, B).find((m) => m.type === 'layOff' && m.card === id('6H'));
    expect(layOff).toBeDefined();
    s = play(s, layOff as Move, arrange(B, ['JC', 'QC', 'KC']), choose(B, 'show'));
    // b's deadwood: 2 + 8 + 1 + 4 + 5 + 10 = 30; a's: 2. a scores the difference.
    expect(score(s, A)).toBe(28);
    expect(score(s, B)).toBe(0);
  });

  it("doesn't offer a knock above the limit", () => {
    const { state, A, B } = table(MELDS.concat('JD'), B_HAND, { stock: ['8C', '8H', 'QS'] });
    const s = passAndCycle(applyMove(state, arrangeA(A)), A, B, 'QS');
    // Deadwood 10 is allowed…
    expect(types(s, A)).toContain('choose');
    const high = table(MELDS.concat('JD', 'AD').slice(1), B_HAND, { stock: ['8C', '8H', 'QS'] });
    // …but breaking the hearts run leaves 4 + 5 + 10 + 1 = 20.
    const h = passAndCycle(
      applyMove(high.state, arrange(high.A, ['7C', '7D', '7S'], ['9S', '9D', '9C'])),
      high.A,
      high.B,
      'QS',
    );
    expect(h.cursor.current).toBe(high.B);
  });

  it('gives an undercut to the opponent, with the bonus', () => {
    const b = ['JC', 'QC', 'KC', '2C', '3C', '4C', '4S', '5S', '6S', 'AS'];
    const { state, A, B } = table(MELDS.concat('10D'), b, { stock: ['8C', '8H', 'QS'] });
    let s = passAndCycle(applyMove(state, arrangeA(A)), A, B, 'QS');
    s = play(s, choose(A, 'knock'));
    s = play(
      s,
      arrange(B, ['JC', 'QC', 'KC'], ['2C', '3C', '4C'], ['4S', '5S', '6S']),
      choose(B, 'show'),
    );
    // a 10, b 1: b scores 9 + 25.
    expect(score(s, B)).toBe(34);
    expect(score(s, A)).toBe(0);
  });

  it('scores gin with the bonus, and the opponent may not lay off', () => {
    const b = ['JC', 'QC', 'KC', '2C', '8D', 'AS', '4S', '5S', '10D', 'QH'];
    const { state, A, B } = table(MELDS.concat('6H'), b, { stock: ['8C', '8H', 'QS'] });
    let s = applyMove(
      state,
      arrange(A, ['3H', '4H', '5H', '6H'], ['7C', '7D', '7S'], ['9S', '9D', '9C']),
    );
    s = passAndCycle(s, A, B, 'QS');
    expect(getLegalMoves(s, A)).toContainEqual(choose(A, 'gin'));
    s = applyMove(s, choose(A, 'gin'));
    expect(types(s, B)).not.toContain('layOff');
    s = play(s, arrange(B, ['JC', 'QC', 'KC']), choose(B, 'show'));
    // b's deadwood 2 + 8 + 1 + 4 + 5 + 10 + 10 = 40, plus 25.
    expect(score(s, A)).toBe(65);
  });

  it('allows big gin (all 11 cards, no discard) with that house rule', () => {
    const a = ['2H', '3H', '4H', '5H', '7C', '7D', '7S', '9S', '9D', '9C'];
    const b = ['JC', 'QC', 'KC', '2C', '8D', 'AS', '4S', '5S', '10D', 'QH'];
    const run = ['2H', '3H', '4H', '5H', '6H'];
    const off = table(a, b, { stock: ['8C', '8H', '6H'] });
    const noBig = play(off.state, choose(off.A, 'pass'), choose(off.B, 'pass'), draw(off.A));
    expect(getLegalMoves(noBig, off.A)).not.toContainEqual(choose(off.A, 'bigGin'));

    const { state, A, B } = table(a, b, { options: { bigGin: 31 }, stock: ['8C', '8H', '6H'] });
    let s = play(state, choose(A, 'pass'), choose(B, 'pass'), draw(A));
    s = applyMove(s, arrange(A, run, ['7C', '7D', '7S'], ['9S', '9D', '9C']));
    s = applyMove(s, choose(A, 'bigGin'));
    s = play(s, arrange(B, ['JC', 'QC', 'KC']), choose(B, 'show'));
    expect(score(s, A)).toBe(40 + 31);
  });
});

describe('gin: the end of a hand and of the game', () => {
  it('is a draw when only 2 cards are left in the stock', () => {
    const { state, A, B } = table(MELDS.concat('2D'), ['2C', '3C'], { stock: ['QS', 'JS', '10S'] });
    const s = passAndCycle(state, A, B, '10S');
    expect(s.round).toBe(2);
    expect([score(s, A), score(s, B)]).toEqual([0, 0]);
  });

  it('adds the game bonus, 25 per hand won and doubles a shutout', () => {
    const B_HAND = ['6H', 'JC', 'QC', 'KC', '2C', '8D', 'AS', '4S', '5S', '10D'];
    const finish = (options: Options) => {
      const { state, A, B } = table(MELDS.concat('2D'), B_HAND, {
        options,
        stock: ['8C', '8H', 'QS'],
      });
      const near = draft(state);
      (near.teams[A] as { score: number }).score = 90;
      let s = passAndCycle(applyMove(near, arrangeA(A)), A, B, 'QS');
      s = play(s, choose(A, 'knock'), arrange(B, ['JC', 'QC', 'KC']), choose(B, 'show'));
      return { s, A };
    };
    // b keeps the 6♥ this time: 36 - 2 = 34, so 124; +100 game; +25 for the hand; doubled: b has 0.
    const on = finish({});
    expect(on.s.status).toBe('over');
    expect(score(on.s, on.A)).toBe((124 + 100 + 25) * 2);
    const off = finish({ bonuses: false });
    expect(score(off.s, off.A)).toBe(124);
  });

  it('sets the knock limit from the upcard in Oklahoma, and doubles a spade hand', () => {
    for (let i = 0; i < 40; i++) {
      const state = createGame(gin, { oklahoma: true }, 2, `ok-${i}`);
      const top = state.zones.discard?.[0];
      if (!top || !('rank' in top)) continue;
      const value =
        top.rank === 'A' ? 0 : ['J', 'Q', 'K'].includes(top.rank) ? 10 : Number(top.rank);
      expect(state.vars.knockLimit).toBe(value);
      expect(state.vars.double).toBe(top.suit === 'spades');
    }
    expect(createGame(gin, {}, 2, 'ok-0').vars.knockLimit).toBe(10);
  });
});

describe('gin: hands', () => {
  it('deals 10 each with an upcard', () => {
    const state = createGame(gin, {}, 2, 'deal');
    expect(hand(state, 0)).toHaveLength(10);
    expect(hand(state, 1)).toHaveLength(10);
    expect(state.zones.discard).toHaveLength(1);
  });
});
