import { describe, expect, it } from 'vitest';
import { GameFileError } from '../errors';
import {
  cardLabel,
  cardRank,
  cardSuit,
  isJoker,
  isRank,
  isSuit,
  jokerCard,
  suitedCard,
  type Card,
} from './card';
import { buildDeck, type DeckDef } from './deck';
import { ledSuit, rankIndex, trickWinnerIndex } from './order';

const c = (rank: Parameters<typeof suitedCard>[0], suit: Parameters<typeof suitedCard>[1]) =>
  suitedCard(rank, suit);

describe('cards', () => {
  it('gives each card a readable, copy-specific id', () => {
    expect(suitedCard('Q', 'hearts').id).toBe('QH.0');
    expect(suitedCard('10', 'spades', 1).id).toBe('10S.1');
    expect(jokerCard(2).id).toBe('JOKER.2');
  });

  it('describes suits and ranks, including jokers', () => {
    const joker = jokerCard(0);
    expect(isJoker(joker)).toBe(true);
    expect(cardSuit(joker)).toBeNull();
    expect(cardRank(joker)).toBe('JOKER');
    expect(cardSuit(c('A', 'clubs'))).toBe('clubs');
    expect(cardRank(c('A', 'clubs'))).toBe('A');
    expect(cardLabel(c('Q', 'hearts'))).toBe('Q♥');
    expect(cardLabel(joker)).toBe('Joker');
  });

  it('recognises valid suit and rank names', () => {
    expect(isSuit('spades')).toBe(true);
    expect(isSuit('stars')).toBe(false);
    expect(isRank('10')).toBe(true);
    expect(isRank('1')).toBe(false);
    expect(isRank(10)).toBe(false);
  });
});

describe('buildDeck', () => {
  it('builds a standard 52-card deck by default', () => {
    const deck = buildDeck({});
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.id)).size).toBe(52);
  });

  const nineToAce = ['9', '10', 'J', 'Q', 'K', 'A'] as const;
  it.each<[string, DeckDef, number]>([
    ['spades', { copies: 1, jokers: 0 }, 52],
    ['euchre', { ranks: nineToAce }, 24],
    ['euchre with joker', { ranks: nineToAce, jokers: 1 }, 25],
    ['pinochle', { copies: 2, ranks: nineToAce }, 48],
    ['canasta', { copies: 2, jokers: 2 }, 108],
    ['hand and foot', { copies: 6, jokers: 2 }, 324],
    ['two suits', { suits: ['hearts', 'spades'] }, 26],
  ])('builds %s decks', (_name, def, size) => {
    const deck = buildDeck(def);
    expect(deck).toHaveLength(size);
    expect(new Set(deck.map((card) => card.id)).size).toBe(size);
  });

  it.each([{ copies: 0 }, { copies: 7 }, { copies: 1.5 }, { jokers: 3 }, { jokers: -1 }])(
    'rejects invalid settings %o',
    (def) => {
      expect(() => buildDeck(def)).toThrow(GameFileError);
    },
  );
});

describe('card order', () => {
  it('ranks cards by the given order', () => {
    expect(rankIndex(['2', 'A'], c('A', 'clubs'))).toBe(1);
    expect(rankIndex(['2', 'A'], jokerCard(0))).toBe(-1);
  });

  it('finds the led suit, skipping jokers', () => {
    expect(ledSuit([jokerCard(0), c('3', 'hearts')])).toBe('hearts');
    expect(ledSuit([jokerCard(0)])).toBeNull();
    expect(ledSuit([])).toBeNull();
  });

  const trick: Card[] = [c('10', 'hearts'), c('A', 'clubs'), c('K', 'hearts'), c('2', 'spades')];

  it('highest card of the led suit wins without trump', () => {
    expect(trickWinnerIndex(trick, 'highestLed', 'spades')).toBe(2);
  });

  it('any trump beats the led suit', () => {
    expect(trickWinnerIndex(trick, 'highestTrumpElseHighestLed', 'spades')).toBe(3);
  });

  it('falls back to the led suit when no trump was played', () => {
    expect(trickWinnerIndex(trick, 'highestTrumpElseHighestLed', 'diamonds')).toBe(2);
    expect(trickWinnerIndex(trick, 'highestTrumpElseHighestLed', null)).toBe(2);
  });

  it('first of two identical cards wins', () => {
    const twins = [suitedCard('A', 'hearts', 0), suitedCard('A', 'hearts', 1)];
    expect(trickWinnerIndex(twins, 'highestLed', null)).toBe(0);
  });

  it('jokers never win', () => {
    expect(trickWinnerIndex([jokerCard(0), c('2', 'hearts')], 'highestLed', null)).toBe(1);
  });
});
