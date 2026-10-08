/**
 * The engine's runtime safety nets. createGame validates files first, so
 * these tests start games with startGame, which skips validation, to prove
 * that a broken file which somehow got past the validator still fails with
 * a clear GameFileError instead of hanging or crashing obscurely.
 * validate.test.ts checks that the validator catches the same mistakes.
 */
import { describe, expect, it } from 'vitest';
import { tinyTricks } from './__fixtures__/games';
import { id } from './testing';
import { applyMove } from './api';
import { ExprError, GameFileError } from './errors';
import { startGame as createGame } from './game/setup';
import type { EffectDef, GameFile, PhaseDef } from './game/types';

const trickPhase = tinyTricks.phases[0] as PhaseDef;

/** Tiny Tricks with a different afterTrick list. */
const withAfterTrick = (afterTrick: EffectDef[]): GameFile => ({
  ...tinyTricks,
  phases: [{ ...trickPhase, afterTrick }],
});

/** Tiny Tricks where playing a card runs these effects. */
const withPlayEffects = (effects: EffectDef[]): GameFile => ({
  ...tinyTricks,
  phases: [{ ...trickPhase, actions: [{ type: 'playToTrick', effects }] }],
});

/** Plays one full trick (leader's first card, then the follower's first legal card). */
function playTrick(file: GameFile) {
  const state = createGame(file, {}, 2, 'errors');
  const L = state.cursor.current;
  const first = applyMove(state, { player: L, type: 'playToTrick', card: id('3H') });
  return () => applyMove(first, { player: 1 - L, type: 'playToTrick', card: id('2H') });
}

describe('game file errors', () => {
  it('needs resolveTrick in afterTrick', () => {
    expect(playTrick(withAfterTrick([]))).toThrow('afterTrick must include a resolveTrick');
  });

  it('needs resolveTrick before moveTrick', () => {
    expect(playTrick(withAfterTrick([{ moveTrick: 'won' }]))).toThrow(
      '"moveTrick" must come after "resolveTrick"',
    );
  });

  it("doesn't allow choices in afterTrick", () => {
    const file = withAfterTrick([
      { resolveTrick: 'highestLed' },
      { choose: 'suit', set: 'state.x' },
    ]);
    expect(playTrick(file)).toThrow('"choose" can only be used in an action\'s effects');
  });

  it('needs somewhere to store a choice', () => {
    const state = createGame(withPlayEffects([{ choose: 'suit' }]), {}, 2, 'e');
    const L = state.cursor.current;
    expect(() => applyMove(state, { player: L, type: 'playToTrick', card: id('3H') })).toThrow(
      '"choose" needs "set"',
    );
  });

  it('only sets custom values, and only to plain data', () => {
    const bad = createGame(withPlayEffects([{ set: 'player.score' }]), {}, 2, 'e');
    const L = bad.cursor.current;
    expect(() => applyMove(bad, { player: L, type: 'playToTrick', card: id('3H') })).toThrow(
      '"player.score" is already something else',
    );
    const other = createGame(withPlayEffects([{ set: 'team.x' }]), {}, 2, 'e');
    expect(() => applyMove(other, { player: L, type: 'playToTrick', card: id('3H') })).toThrow(
      'Can only set "state.<name>" or "player.<name>" values',
    );
    const object = createGame(withPlayEffects([{ set: { 'state.x': 'card' } }]), {}, 2, 'e');
    expect(() => applyMove(object, { player: L, type: 'playToTrick', card: id('3H') })).toThrow(
      ExprError,
    );
  });

  it('stores numbers, text, booleans and lists', () => {
    const file = withPlayEffects([
      { set: { 'state.n': 2, 'state.t': 'card.rank', 'state.b': true, 'state.l': '[1, [2]]' } },
    ]);
    const state = createGame(file, {}, 2, 'e');
    const L = state.cursor.current;
    const next = applyMove(state, { player: L, type: 'playToTrick', card: id('3H') });
    expect(next.vars).toEqual({ n: 2, t: '3', b: true, l: [1, [2]] });
  });

  it("doesn't support triggerEffects on the starting flip yet", () => {
    const file: GameFile = {
      ...tinyTricks,
      zones: { ...tinyTricks.zones, pile: { shared: true, visibility: 'all' } },
      setup: { ...tinyTricks.setup, deal: { to: 'hand', count: 3 }, rest: 'pile' },
    };
    const flip = (triggerEffects: boolean) => ({
      ...file,
      setup: { ...file.setup, flip: { from: 'pile', to: 'trick', triggerEffects } },
    });
    expect(() => createGame(flip(true), {}, 2, 'e')).toThrow('triggerEffects');
    expect(() => createGame(flip(false), {}, 2, 'e')).not.toThrow();
  });

  it('reports a flip from an empty pile', () => {
    const file: GameFile = {
      ...tinyTricks,
      setup: { ...tinyTricks.setup, flip: { from: 'trick', to: 'trick' } },
    };
    expect(() => createGame(file, {}, 2, 'e')).toThrow('No card left in "trick" to flip');
  });

  it('reports unknown zones', () => {
    const file: GameFile = { ...tinyTricks, setup: { deal: { to: 'hands', count: 4 } } };
    expect(() => createGame(file, {}, 2, 'e')).toThrow('Zone "hands" isn\'t defined');
  });

  it('reports a per-player zone used where no player is involved', () => {
    const file: GameFile = { ...tinyTricks, setup: { ...tinyTricks.setup, rest: 'won' } };
    expect(() => createGame(file, {}, 2, 'e')).toThrow('belongs to a player');
  });

  it('reports a round that ends without any moves', () => {
    const file: GameFile = { ...tinyTricks, phases: [] };
    expect(() => createGame(file, {}, 2, 'e')).toThrow(GameFileError);
    expect(() => createGame(file, {}, 2, 'e')).toThrow('without any moves');
  });

  it('reports a bad bid range', () => {
    const file: GameFile = {
      ...tinyTricks,
      phases: [{ name: 'bid', rounds: 1, actions: [{ type: 'bid', values: { range: [5, 1] } }] }],
    };
    expect(() => createGame(file, {}, 2, 'e')).toThrow('Bid range [5, 1]');
  });

  it("stops a play rule that depends on whether there's a legal play", () => {
    const file: GameFile = {
      ...tinyTricks,
      phases: [{ ...trickPhase, actions: [{ type: 'playToTrick', if: 'player.hasLegalPlay' }] }],
    };
    expect(() => createGame(file, {}, 2, 'e')).toThrow('cannot itself depend on');
  });

  it('reports a player with no card to play to a trick', () => {
    // Deal 4 cards each but take one from the follower: the trick can't complete.
    const state = createGame(tinyTricks, {}, 2, 'e');
    const L = state.cursor.current;
    const uneven = { ...state, zones: { ...state.zones, [`hand@${1 - L}`]: [] } };
    expect(() => applyMove(uneven, { player: L, type: 'playToTrick', card: id('3H') })).toThrow(
      'has no card to play to the trick',
    );
  });
});
