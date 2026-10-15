import type { Card } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { cardFromId, shortLabel, sortHand } from './cards';

const hand = (...ids: string[]) => ids.map((id) => cardFromId(`${id}.0`) as Card);
const labels = (cards: Card[]) => cards.map(shortLabel);

describe('sortHand', () => {
  const cards = hand('JD', 'AH', 'JH', '9H', 'JS', 'KC', 'JC');

  it('groups suits, alternating colours, low to high', () => {
    expect(labels(sortHand(cards))).toEqual(['J♠', '9♥', 'J♥', 'A♥', 'J♣', 'K♣', 'J♦']);
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
