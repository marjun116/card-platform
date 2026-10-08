import { describe, expect, it } from 'vitest';
import { card } from '../testing';
import { RANKS, type Rank } from './card';
import { countPairs, countSums, runAtEnd, runCards, sameRankAtEnd } from './patterns';

const ACE_LOW: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const cards = (...specs: string[]) => specs.map(card);

describe('countSums', () => {
  it('counts every different group adding up to the total', () => {
    expect(countSums([5, 10], 15)).toBe(1);
    // 5 + 10 four ways, 5 + 5 + 5 once.
    expect(countSums([5, 5, 5, 10], 15)).toBe(4);
    // Four 5s and a 10: each 5 with the 10 (4 ways) and any three 5s (4 ways).
    expect(countSums([5, 5, 5, 5, 10], 15)).toBe(8);
    expect(countSums([1, 2, 3], 15)).toBe(0);
  });

  it('ignores nonsense', () => {
    expect(countSums([5, 10], 0)).toBe(0);
    expect(countSums([5, 10], 2.5)).toBe(0);
    expect(countSums([0, 15], 15)).toBe(1);
  });
});

describe('countPairs', () => {
  it('counts pairs of the same rank', () => {
    expect(countPairs(cards('5H', '5S', '9C'))).toBe(1);
    expect(countPairs(cards('5H', '5S', '5C'))).toBe(3);
    expect(countPairs(cards('5H', '5S', '5C', '5D'))).toBe(6);
    expect(countPairs(cards('5H', '5S', '9C', '9D'))).toBe(2);
    expect(countPairs(cards('JOKER.0', 'JOKER.1'))).toBe(0);
  });
});

describe('runCards', () => {
  it('counts the cards in runs of 3 or more', () => {
    expect(runCards(cards('3H', '4S', '5C'), ACE_LOW)).toBe(3);
    expect(runCards(cards('3H', '4S', '5C', '6D'), ACE_LOW)).toBe(4);
    expect(runCards(cards('3H', '4S', '9C'), ACE_LOW)).toBe(0);
  });

  it('counts a run once for each different set of cards that makes it', () => {
    // Double run: 3-4-5 twice.
    expect(runCards(cards('3H', '3S', '4C', '5D'), ACE_LOW)).toBe(6);
    // Double double run: 3-4-5 four times.
    expect(runCards(cards('3H', '3S', '4C', '4D', '5D'), ACE_LOW)).toBe(12);
    // Triple run.
    expect(runCards(cards('3H', '3S', '3C', '4D', '5D'), ACE_LOW)).toBe(9);
    // Double run of 4.
    expect(runCards(cards('3H', '4S', '5C', '6D', '6H'), ACE_LOW)).toBe(8);
  });

  it("uses the game's rank order and doesn't go round the corner", () => {
    expect(runCards(cards('AH', '2S', '3C'), ACE_LOW)).toBe(3);
    expect(runCards(cards('AH', '2S', '3C'), RANKS)).toBe(0);
    expect(runCards(cards('QH', 'KS', 'AC'), ACE_LOW)).toBe(0);
    expect(runCards(cards('QH', 'KS', 'AC'), RANKS)).toBe(3);
    expect(runCards(cards('KH', 'AS', '2C'), RANKS)).toBe(0);
  });

  it('counts separate runs separately', () => {
    expect(runCards(cards('AH', '2S', '3C', '5H', '6S', '7C'), ACE_LOW)).toBe(6);
  });
});

describe('the top of a pile', () => {
  it('counts the cards on top that share a rank', () => {
    expect(sameRankAtEnd(cards())).toBe(0);
    expect(sameRankAtEnd(cards('5H'))).toBe(1);
    expect(sameRankAtEnd(cards('5H', '5S'))).toBe(2);
    expect(sameRankAtEnd(cards('5H', '5S', '9C', '9D', '9S'))).toBe(3);
    expect(sameRankAtEnd(cards('5H', '9S', '5C'))).toBe(1);
  });

  it('finds the longest run made by the cards on top, in any order', () => {
    expect(runAtEnd(cards('4H', '6S', '5C'), ACE_LOW)).toBe(3);
    // 4-6-5 then a 3: the last four make a run.
    expect(runAtEnd(cards('4H', '6S', '5C', '3D'), ACE_LOW)).toBe(4);
    // A card in between breaks it: 4-6-5-9 has no run on top.
    expect(runAtEnd(cards('4H', '6S', '5C', '9D'), ACE_LOW)).toBe(0);
    // The run must be on top: 9 4 5 6 is a run of 3.
    expect(runAtEnd(cards('9D', '4H', '5S', '6C'), ACE_LOW)).toBe(3);
    // A pair on top is no run.
    expect(runAtEnd(cards('4H', '5S', '6C', '6D'), ACE_LOW)).toBe(0);
    expect(runAtEnd(cards('4H', '5S'), ACE_LOW)).toBe(0);
  });
});
