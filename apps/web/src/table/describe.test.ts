import type { TableInfo } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import { cardFromId, cardImage, shortLabel, spokenLabel, suitClass } from './cards';
import { bidLabel, describeMove, moveLabel, seatNames } from './describe';

const table = {
  seats: [
    { seat: 0, user: { id: 'a', displayName: 'Ana' }, connected: true },
    { seat: 1, user: null, connected: false },
  ],
} as unknown as TableInfo;
const names = seatNames(table, 2);

describe('words for moves', () => {
  it('names seats', () => {
    expect([names(0), names(1), names(2)]).toEqual(['Ana', 'Seat 2', 'You']);
  });

  it('labels buttons', () => {
    expect(moveLabel({ player: 2, type: 'playToTrick', card: 'QS.0' }, names)).toBe('Play Q♠');
    expect(moveLabel({ player: 2, type: 'draw', from: 'stock' }, names)).toBe(
      'Draw from the stock',
    );
    expect(moveLabel({ player: 2, type: 'bid', value: 'blindNil' }, names)).toBe('Bid Blind nil');
    const layOff = { zone: 'melds@0', index: 1 };
    expect(moveLabel({ player: 2, type: 'layOff', card: '5D.1', meld: layOff }, names)).toBe(
      "Lay 5♦ off on Ana's melds (group 2)",
    );
  });

  it('writes log lines with spoken card names', () => {
    expect(describeMove({ player: 0, type: 'playToTrick', card: '10H.0' }, names)).toBe(
      'Ana played 10 of hearts',
    );
    expect(describeMove({ player: 0, type: 'bid', value: 'nil' }, names)).toBe('Ana bid nil');
    expect(describeMove({ player: 0, type: 'pass', hidden: true }, names)).toBe('Ana passed cards');
    expect(describeMove({ player: 2, type: 'endTurn' }, names)).toBe('You ended your turn');
  });

  it('labels bids', () => {
    expect(bidLabel(4)).toBe('4');
    expect(bidLabel('nil')).toBe('Nil');
  });
});

describe('cards', () => {
  it('reads card ids', () => {
    expect(cardFromId('QH.0')).toEqual({ id: 'QH.0', suit: 'hearts', rank: 'Q' });
    expect(cardFromId('10S.1')).toEqual({ id: '10S.1', suit: 'spades', rank: '10' });
    expect(cardFromId('JOKER.0')).toEqual({ id: 'JOKER.0', joker: true });
    expect(cardFromId('ZZ')).toBeNull();
  });

  it('labels cards', () => {
    const card = { id: 'AS.0', suit: 'spades', rank: 'A' } as const;
    expect(shortLabel(card)).toBe('A♠');
    expect(spokenLabel(card)).toBe('Ace of spades');
  });

  it('uses four-colour pictures for clubs and diamonds number cards only', () => {
    const sevenOfDiamonds = { id: '7D.0', suit: 'diamonds', rank: '7' } as const;
    expect(cardImage(sevenOfDiamonds, true)).toBe('/cards/four-color/7D.svg');
    expect(cardImage(sevenOfDiamonds, false)).toBe('/cards/7D.svg');
    expect(cardImage({ id: 'KC.0', suit: 'clubs', rank: 'K' }, true)).toBe('/cards/KC.svg');
    expect(cardImage({ id: '7H.0', suit: 'hearts', rank: '7' }, true)).toBe('/cards/7H.svg');
    expect(cardImage({ id: 'JOKER.0', joker: true }, true)).toBeNull();
  });

  it('colours suits', () => {
    expect(suitClass('diamonds', true)).toBe('suit-diamonds');
    expect(suitClass('diamonds', false)).toBe('suit-hearts');
    expect(suitClass('clubs', false)).toBe('suit-spades');
  });
});
