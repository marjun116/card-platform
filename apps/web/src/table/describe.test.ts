import type { TableInfo } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import { cardFromId, cardImage, isRed, shortLabel, spokenLabel } from './cards';
import type { CardEvent, PlayerView } from '@card-table/engine';
import {
  bidLabel,
  describeCards,
  describeMove,
  describeScore,
  logLines,
  moveLabel,
  seatNames,
  seatStats,
} from './describe';

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

  it("uses the game file's words for named choices", () => {
    const choices = { shooterMinus26: 'Take 26 off my score' };
    const minus = { player: 0, type: 'choose', value: 'shooterMinus26' } as const;
    const plus = { player: 0, type: 'choose', value: 'othersGet26' } as const;
    expect(moveLabel(minus, names, choices)).toBe('Take 26 off my score');
    expect(moveLabel(plus, names, choices)).toBe('Others get26');
    expect(describeMove(minus, names, choices)).toBe('Ana chose: Take 26 off my score');
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

  it('finds card pictures by card id', () => {
    expect(cardImage({ id: '7D.0', suit: 'diamonds', rank: '7' })).toBe('/cards/7D.svg');
    expect(cardImage({ id: '10S.1', suit: 'spades', rank: '10' })).toBe('/cards/10S.svg');
    expect(cardImage({ id: 'JOKER.0', joker: true })).toBeNull();
  });

  it('colours hearts and diamonds red', () => {
    expect(isRed('hearts')).toBe(true);
    expect(isRed('diamonds')).toBe(true);
    expect(isRed('spades')).toBe(false);
    expect(isRed('clubs')).toBe(false);
  });
});

describe('seatStats', () => {
  const player = { bid: 3, tricks: 1, active: true };

  it('writes the bid and tricks won in short and in full', () => {
    expect(seatStats(player, 5, true)).toEqual({
      short: 'B3 · W1',
      spoken: 'bid 3, won 1, 5 cards',
    });
  });

  it('only shows what the game has', () => {
    expect(seatStats({ ...player, bid: null }, 7, false)).toEqual({
      short: null,
      spoken: '7 cards',
    });
    expect(seatStats({ ...player, bid: 'blindNil' }, 1, true).short).toBe('Blind nil · W1');
    expect(seatStats({ ...player, active: false }, 0, false).short).toBe('B3 · Out');
  });

  it('says when a player sits this hand out (a lone player’s partner)', () => {
    expect(seatStats({ ...player, bid: null, sittingOut: true }, 5, true)).toEqual({
      short: 'W1 · Sits out',
      spoken: 'won 1, 5 cards, sitting out this hand',
    });
  });
});

describe('describeScore', () => {
  const event = { round: 1, at: 3, player: 0, team: 0, points: 2, label: 'Fifteen', into: null };
  it('writes points scored as cards are played', () => {
    expect(describeScore(event, names)).toBe('Ana: Fifteen for 2');
    expect(describeScore({ ...event, label: null }, names)).toBe('Ana scored 2');
  });

  it('says when points are held rather than scored (pinochle meld)', () => {
    expect(describeScore({ ...event, label: 'Aces around', points: 10, into: 'meld' }, names)).toBe(
      'Ana: Aces around for 10 (meld)',
    );
  });
});

describe('cards turned up and given out', () => {
  const turned: CardEvent = {
    round: 1,
    at: 0,
    kind: 'turnedUp',
    zone: 'upcard',
    player: null,
    cards: ['JH.0'],
  };
  const given: CardEvent = { ...turned, at: 4, kind: 'given', player: 0 };

  it('names the card when everyone saw it', () => {
    expect(describeCards(turned, names)).toBe('Turned up: Jack of hearts');
    expect(describeCards(given, names)).toBe('Ana picked up Jack of hearts');
    expect(describeCards({ ...given, player: 2 }, names)).toBe('You picked up Jack of hearts');
  });

  it("says only where cards came from when they weren't seen", () => {
    expect(describeCards({ ...turned, cards: [] }, names)).toBeNull();
    expect(describeCards({ ...given, cards: [], zone: 'kitty' }, names)).toBe('Ana took the kitty');
  });

  it('puts them in the log after the move that led to them', () => {
    const pass = (player: number) => ({ player, type: 'choose' as const, value: 'pass' });
    const view = {
      log: [pass(1), pass(0), pass(1), pass(0)],
      scoreEvents: [],
      cardEvents: [turned, given],
      choiceLabels: {},
      bidLabels: {},
    } as unknown as PlayerView;
    expect(logLines(view, names)).toEqual([
      'Turned up: Jack of hearts',
      'Seat 2 chose: Pass',
      'Ana chose: Pass',
      'Seat 2 chose: Pass',
      'Ana chose: Pass',
      'Ana picked up Jack of hearts',
    ]);
  });
});

describe('words for taking a pile and going out', () => {
  it('labels and logs the new kinds of move', () => {
    const withCards = {
      player: 0,
      type: 'pickUpPile' as const,
      from: 'discard',
      cards: ['7S.0', '7D.0'],
    };
    expect(moveLabel(withCards, names)).toBe('Take the discard, melding its top card with 7♠ 7♦');
    expect(describeMove(withCards, names)).toBe(
      'Ana took the discard, melding its top card with 7 of spades, 7 of diamonds',
    );
    const onto = {
      player: 0,
      type: 'pickUpPile' as const,
      from: 'discard',
      meld: { zone: 'melds@t0', index: 1 },
    };
    expect(moveLabel(onto, names)).toBe('Take the discard, adding its top card to meld 2');
    expect(describeMove(onto, names)).toBe('Ana took the discard, adding its top card to a meld');
    const out = { player: 0, type: 'showHand' as const, card: null, to: 'discard' };
    expect(moveLabel(out, names)).toBe('Go out');
    expect(describeMove(out, names)).toBe('Ana went out');
  });
});

describe("the game's own words for bids, and moves made for another seat", () => {
  const bids = { '11': '1♣', '35': '3NT' };

  it('uses bid labels as written, even mid-sentence', () => {
    expect(bidLabel(35, bids)).toBe('3NT');
    expect(moveLabel({ player: 2, type: 'bid', value: 35 }, names, {}, bids)).toBe('Bid 3NT');
    expect(describeMove({ player: 0, type: 'bid', value: 35 }, names, {}, bids)).toBe(
      'Ana bid 3NT',
    );
    // Bids with no label are as before.
    expect(describeMove({ player: 0, type: 'bid', value: 'double' }, names, {}, bids)).toBe(
      'Ana bid double',
    );
    expect(seatStats({ bid: 11, tricks: 0, active: true }, null, false, bids)).toEqual({
      short: '1♣',
      spoken: 'bid 1♣',
    });
  });

  it('says whose cards a move for another seat uses', () => {
    const forAna = { player: 0, by: 2, type: 'playToTrick' as const, card: 'QS.0' };
    expect(moveLabel(forAna, names)).toBe('Play Q♠ for Ana');
    expect(describeMove(forAna, names)).toBe('You (for Ana) played Queen of spades');
  });
});
