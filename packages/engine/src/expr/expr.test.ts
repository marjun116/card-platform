import { describe, expect, it } from 'vitest';
import { ExprError } from '../errors';
import {
  compile,
  evaluate,
  evaluateCondition,
  evaluateNumber,
  openObject,
  type Scope,
  scopeOf,
  type Value,
} from './evaluate';
import { tokenize } from './lexer';
import { MAX_DEPTH, MAX_LENGTH, parse } from './parser';

const scope = (names: Record<string, Value> = {}): Scope => scopeOf(names);
const ev = (source: string, names: Record<string, Value> = {}) => evaluate(source, scope(names));

describe('lexer', () => {
  it('splits numbers, strings, names and operators', () => {
    expect(tokenize(`hand.count >= 2.5 && x != 'a b'`).map((t) => t.type)).toEqual([
      'name',
      'op',
      'name',
      'op',
      'num',
      'op',
      'name',
      'op',
      'str',
      'eof',
    ]);
  });

  it('supports both quote styles and escapes', () => {
    expect(ev(`"it's"`)).toBe("it's");
    expect(ev(`'say \\'hi\\''`)).toBe("say 'hi'");
  });

  it.each([
    ['a = 1', 'Use =='],
    ['a # b', 'Unexpected character'],
    ["'open", 'Unclosed string'],
  ])('rejects %s', (source, message) => {
    expect(() => tokenize(source)).toThrow(message);
  });
});

describe('parser', () => {
  it('follows operator precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('-2 * 3')).toBe(-6);
    expect(ev('1 + 1 == 2 && 3 > 2')).toBe(true);
    expect(ev('true || false && false')).toBe(true);
    expect(ev('!false && true')).toBe(true);
  });

  it('parses nested ternaries right to left', () => {
    expect(ev('false ? 1 : true ? 2 : 3')).toBe(2);
    expect(ev('1 > 0 ? 100 : -100')).toBe(100);
  });

  it('parses arrays and member chains', () => {
    expect(parse('a.b.c')).toEqual({
      kind: 'member',
      object: { kind: 'member', object: { kind: 'name', name: 'a' }, name: 'b' },
      name: 'c',
    });
    expect(ev('[1, "x", [true]]')).toEqual([1, 'x', [true]]);
    expect(ev('[]')).toEqual([]);
  });

  it.each([
    ['1 +', 'Unexpected end of expression'],
    ['(1', 'Expected ")"'],
    ['[1 2]', 'Expected "," or "]"'],
    ['1 2', 'Unexpected "2"'],
    ['a.', 'property name'],
    ['[a](1)', 'Only named functions'],
    ['1 ? 2', 'Expected ":"'],
    ['in', 'Unexpected "in"'],
  ])('reports a readable error for %s', (source, message) => {
    expect(() => parse(source)).toThrow(message);
  });

  it('limits length and nesting', () => {
    expect(() => parse('1+'.repeat(MAX_LENGTH))).toThrow('longer than');
    expect(() => parse('('.repeat(MAX_DEPTH + 1) + '1' + ')'.repeat(MAX_DEPTH + 1))).toThrow(
      'nested',
    );
  });
});

describe('evaluator', () => {
  const card = { id: 'QH.0', rank: 'Q', suit: 'hearts' };
  const names = {
    card,
    hand: { count: 3, onlySuit: (s: Value) => s === 'spades' },
    state: openObject({ spadesBroken: true }),
  };

  it('reads names and properties', () => {
    expect(ev('card.rank', names)).toBe('Q');
    expect(ev('hand.count == 3', names)).toBe(true);
    expect(ev(`card.rank in ['J', 'Q', 'K']`, names)).toBe(true);
    expect(ev(`card.rank in ['A']`, names)).toBe(false);
  });

  it('calls engine-provided functions', () => {
    expect(ev(`hand.onlySuit('spades')`, names)).toBe(true);
    expect(() => ev('card.rank()', names)).toThrow('"rank" is not a function');
  });

  it('reads unset custom state as null, which counts as false', () => {
    expect(ev('state.spadesBroken', names)).toBe(true);
    expect(ev('state.heartsBroken', names)).toBeNull();
    expect(ev('state.heartsBroken || false', names)).toBe(false);
    expect(ev('!state.heartsBroken', names)).toBe(true);
  });

  it('reads properties of null as null', () => {
    expect(ev('pile.top.rank', { pile: { top: null } })).toBeNull();
  });

  it('lists have a count', () => {
    expect(ev('[1, 2, 3].count')).toBe(3);
    expect(() => ev('[1].length')).toThrow('"count"');
  });

  it('compares across types as unequal instead of failing', () => {
    expect(ev(`1 == '1'`)).toBe(false);
    expect(ev(`1 != '1'`)).toBe(true);
    expect(ev('null == null')).toBe(true);
    expect(ev('[1, [2]] == [1, [2]]')).toBe(true);
    expect(ev('[1] == [1, 2]')).toBe(false);
  });

  it('compares cards by id', () => {
    expect(ev('a == b', { a: card, b: { ...card } })).toBe(true);
    expect(ev('a == b', { a: card, b: { ...card, id: 'QH.1' } })).toBe(false);
    expect(ev('a == b', { a: { x: 1 }, b: { x: 1 } })).toBe(false);
  });

  it('does arithmetic on numbers only', () => {
    expect(ev('7 % 3 + 10 / 4')).toBe(3.5);
    expect(() => ev(`'a' + 1`)).toThrow('needs numbers');
    expect(() => ev('1 / 0')).toThrow('Division by zero');
    expect(() => ev('1 % 0')).toThrow('Division by zero');
    expect(() => ev(`-'a'`)).toThrow('needs numbers');
    expect(() => ev(`'a' < 'b'`)).toThrow('needs numbers');
  });

  it('requires booleans for logic', () => {
    expect(() => ev('1 && true')).toThrow('needs true/false');
    expect(() => ev('!1')).toThrow('needs true/false');
    expect(() => ev('1 ? 2 : 3')).toThrow('needs true/false');
    expect(() => ev('1 in 2')).toThrow('needs a list');
  });

  it('short-circuits && and ||', () => {
    expect(ev('false && missing.thing')).toBe(false);
    expect(ev('true || missing.thing')).toBe(true);
  });

  it('rejects unknown names and properties', () => {
    expect(() => ev('nope')).toThrow('Unknown name "nope"');
    expect(() => ev('card.colour', names)).toThrow('Unknown property "colour"');
    expect(() => ev('card.rank.x', names)).toThrow(`Can't read "x"`);
  });

  it('includes the expression in error messages', () => {
    expect(() => ev('nope + 1')).toThrow('in "nope + 1"');
    expect(() => ev('nope')).toThrow(ExprError);
  });
});

describe('safety', () => {
  // Game files are data: nothing in an expression may reach JavaScript internals.
  it.each([
    'card.constructor',
    'card.__proto__',
    'card.toString',
    'card.hasOwnProperty',
    'state.constructor',
    'constructor',
    'toString',
    '__proto__',
    'valueOf',
    'globalThis',
    'process',
  ])('cannot reach %s', (source) => {
    const names = { card: { id: 'x' }, state: openObject({}) };
    const result = (() => {
      try {
        return ev(source, names);
      } catch (error) {
        return error;
      }
    })();
    // Either an error or (for open objects) a harmless null.
    if (result instanceof Error) expect(result).toBeInstanceOf(ExprError);
    else expect(result).toBeNull();
  });
});

describe('quantifiers', () => {
  const players = [
    { hand: { count: 2 }, score: 10 },
    { hand: { count: 0 }, score: 40 },
  ];
  const teams = [{ score: 300 }, { score: 520 }];
  const q: Scope = scopeOf({ target: 500 }, { players: () => players, teams: () => teams });

  it('anyPlayer is true if any player matches', () => {
    expect(evaluate('anyPlayer.hand.count == 0', q)).toBe(true);
    expect(evaluate('anyPlayer.score > 100', q)).toBe(false);
  });

  it('everyPlayer is true only if all match', () => {
    expect(evaluate('everyPlayer.score >= 10', q)).toBe(true);
    expect(evaluate('everyPlayer.hand.count == 0', q)).toBe(false);
  });

  it('anyTeam and everyTeam range over teams', () => {
    expect(evaluate('anyTeam.score >= target', q)).toBe(true);
    expect(evaluate('everyTeam.score >= target', q)).toBe(false);
  });

  it('refers to the same player throughout one expression', () => {
    expect(evaluate('anyPlayer.hand.count == 0 && anyPlayer.score == 10', q)).toBe(false);
  });

  it('allows only one kind of quantifier', () => {
    expect(() => compile('anyPlayer.score > 0 && anyTeam.score > 0')).toThrow('only one');
  });

  it('is false (any) or true (every) with nobody to check', () => {
    expect(evaluate('anyPlayer.score > 0', scopeOf({}))).toBe(false);
    expect(evaluate('everyPlayer.score > 0', scopeOf({}))).toBe(true);
  });

  it('needs a true/false body', () => {
    expect(() => evaluate('anyPlayer.score', q)).toThrow('Expected true/false');
  });
});

describe('typed helpers', () => {
  it('evaluateCondition treats null as false and rejects non-booleans', () => {
    expect(evaluateCondition('null', scope())).toBe(false);
    expect(evaluateCondition('1 < 2', scope())).toBe(true);
    expect(() => evaluateCondition('1', scope())).toThrow('Expected true/false');
  });

  it('evaluateNumber passes numbers through and checks results', () => {
    expect(evaluateNumber(5, scope())).toBe(5);
    expect(evaluateNumber('2 * 3', scope())).toBe(6);
    expect(() => evaluateNumber(`'x'`, scope())).toThrow('Expected a number');
  });

  it('caches compiled expressions', () => {
    expect(compile('1 + 1')).toBe(compile('1 + 1'));
  });
});
