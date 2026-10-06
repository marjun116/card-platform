import { describe, expect, it } from 'vitest';
import { card } from '../testing';
import { jokerCard, RANKS, suitedCard } from '../cards/card';
import { combinations } from './common';
import { canLayOff, findMelds, meldKind, sortMeld } from './melds';

const cards = (...specs: string[]) => specs.map(card);
const ids = (melds: { id: string }[][]) =>
  melds.map((m) =>
    m
      .map((c) => c.id)
      .sort()
      .join(' '),
  );

describe('meldKind', () => {
  it('recognises sets and runs', () => {
    expect(meldKind(cards('7H', '7S', '7D'))).toBe('set');
    expect(meldKind(cards('5H', '3H', '4H'))).toBe('run');
    expect(meldKind(cards('5H', '3H', '6H'))).toBeNull();
    expect(meldKind(cards('5H', '6S', '7H'))).toBeNull();
    expect(meldKind([])).toBeNull();
    expect(meldKind([jokerCard(0), card('2H'), card('3H')])).toBeNull();
  });

  it('uses the game rank order (ace low here)', () => {
    const aceLow = ['A', ...RANKS.slice(0, -1)] as const;
    expect(meldKind(cards('AH', '2H', '3H'), aceLow)).toBe('run');
    expect(meldKind(cards('AH', '2H', '3H'))).toBeNull();
    expect(meldKind(cards('AH', '2H', '3H'), ['2', '3'])).toBeNull();
  });
});

describe('findMelds', () => {
  it('finds every set of at least the minimum size', () => {
    const melds = findMelds(cards('KC', 'KD', 'KS', 'KH', '2C'), ['set'], 3);
    expect(melds).toHaveLength(5); // four ways to pick three kings, plus all four
  });

  it('finds every run window of at least the minimum size', () => {
    const melds = findMelds(cards('3H', '4H', '5H', '6H', '9H'), ['run'], 3);
    expect(ids(melds).sort()).toEqual(
      ['3H.0 4H.0 5H.0', '3H.0 4H.0 5H.0 6H.0', '4H.0 5H.0 6H.0'].sort(),
    );
  });

  it('uses one copy per rank for runs in multi-deck games', () => {
    const hand = [
      suitedCard('3', 'hearts', 0),
      suitedCard('3', 'hearts', 1),
      card('4H'),
      card('5H'),
    ];
    expect(findMelds(hand, ['run'], 3)).toHaveLength(1);
  });

  it('offers single cards as runs when the minimum is 1', () => {
    expect(findMelds(cards('3H'), ['run'], 1)).toHaveLength(1);
  });

  it('limits huge same-rank groups to one meld', () => {
    const many = Array.from({ length: 10 }, (_, i) => suitedCard('9', 'clubs', i));
    expect(findMelds(many, ['set'], 3)).toHaveLength(1);
  });
});

describe('laying off', () => {
  it('adds matching ranks to sets and extends runs at either end', () => {
    expect(canLayOff(cards('7H', '7S', '7D'), card('7C'))).toBe(true);
    expect(canLayOff(cards('7H', '7S', '7D'), card('8C'))).toBe(false);
    expect(canLayOff(cards('3H', '4H', '5H'), card('6H'))).toBe(true);
    expect(canLayOff(cards('3H', '4H', '5H'), card('2H'))).toBe(true);
    expect(canLayOff(cards('3H', '4H', '5H'), card('7H'))).toBe(false);
    expect(canLayOff(cards('3H', '4H', '5H'), jokerCard(0))).toBe(false);
    expect(canLayOff(cards('3H', '9S'), card('4H'))).toBe(false);
  });

  it('keeps melds in rank order', () => {
    const meld = cards('5H', '3H', '4H');
    sortMeld(meld);
    expect(meld.map((c) => c.id)).toEqual(['3H.0', '4H.0', '5H.0']);
  });
});

describe('combinations', () => {
  it('lists every way to choose k items', () => {
    expect(combinations([1, 2, 3], 2)).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(combinations([1, 2], 0)).toEqual([[]]);
    expect(combinations([1], 2)).toEqual([]);
    expect(
      combinations(
        Array.from({ length: 13 }, (_, i) => i),
        3,
      ),
    ).toHaveLength(286);
  });
});
