import type { Card } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { cardFromId, isTrump, shortLabel, sortHand } from './cards';

const hand = (...ids: string[]) => ids.map((id) => cardFromId(`${id}.0`) as Card);
const labels = (cards: Card[]) => cards.map(shortLabel);

describe('sortHand', () => {
  const cards = hand('JD', 'AH', 'JH', '9H', 'JS', 'KC', 'JC');

  it('groups suits, alternating colours, low to high', () => {
    expect(labels(sortHand(cards))).toEqual(['J♠', '9♥', 'J♥', 'A♥', 'J♣', 'K♣', 'J♦']);
  });

  it("follows the game's suit order (hearts last), with any suits it leaves out after", () => {
    expect(labels(sortHand(cards, null, ['spades', 'diamonds', 'clubs', 'hearts']))).toEqual([
      'J♠',
      'J♦',
      'J♣',
      'K♣',
      '9♥',
      'J♥',
      'A♥',
    ]);
    expect(labels(sortHand(cards, null, ['clubs']))).toEqual([
      'J♣',
      'K♣',
      'J♠',
      '9♥',
      'J♥',
      'A♥',
      'J♦',
    ]);
  });

  it('puts both bowers at the top of trump: the left, then the right', () => {
    expect(labels(sortHand(cards, { suit: 'hearts', bowers: true }))).toEqual([
      'J♠',
      '9♥',
      'A♥',
      'J♦',
      'J♥',
      'J♣',
      'K♣',
    ]);
    expect(labels(sortHand(cards, { suit: 'clubs', bowers: true }))).toEqual([
      '9♥',
      'J♥',
      'A♥',
      'K♣',
      'J♠',
      'J♣',
      'J♦',
    ]);
  });

  it('leaves the jacks in their own suits without bowers', () => {
    expect(sortHand(cards, { suit: 'hearts', bowers: false })).toEqual(sortHand(cards));
  });
});

describe('isTrump', () => {
  const card = (id: string) => cardFromId(id) as Card;

  it("is trump's suit, and nothing without trump", () => {
    const hearts = { suit: 'hearts' as const, bowers: false };
    expect(isTrump(card('2H.0'), hearts)).toBe(true);
    expect(isTrump(card('JD.0'), hearts)).toBe(false);
    expect(isTrump(card('2H.0'), null)).toBe(false);
    expect(isTrump({ id: 'JOKER.0', joker: true }, hearts)).toBe(false);
  });

  it("counts the other jack of trump's colour with bowers (euchre)", () => {
    const hearts = { suit: 'hearts' as const, bowers: true };
    expect(isTrump(card('JD.0'), hearts)).toBe(true);
    expect(isTrump(card('JC.0'), hearts)).toBe(false);
    expect(isTrump(card('QD.0'), hearts)).toBe(false);
  });
});
