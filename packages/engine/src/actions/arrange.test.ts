import { describe, expect, it } from 'vitest';
import { type Card, cardRank, isJoker, jokerCard, suitedCard } from '../cards/card';
import { card } from '../testing';
import { type AcesRule, bestArrangement, canAddToMeld, groupInfo, type MeldRules } from './arrange';

const cards = (...specs: string[]) =>
  specs.map((s, i) => (s === 'JK' ? jokerCard(i) : s.endsWith("'") ? copy(s) : card(s)));
/** "7H'" is the second deck's 7♥. */
const copy = (spec: string): Card => {
  const c = card(spec.slice(0, -1));
  return 'suit' in c ? suitedCard(c.rank, c.suit, 1) : c;
};
const rules = (aces: AcesRule = 'low', wildRank: string | null = null): MeldRules => ({
  kinds: ['set', 'run'],
  minSize: 3,
  aces,
  isWild: (c) => wildRank !== null && !isJoker(c) && cardRank(c) === wildRank,
});
const value = (c: Card) => {
  if (isJoker(c)) return 0;
  const rank = cardRank(c);
  return rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(rank) ? 10 : Number(rank);
};
const show = (groups: Card[][]) =>
  groups.map((g) => g.map((c) => c.id.split('.')[0]).join(' ')).sort();

describe('groupInfo', () => {
  it('recognises sets (different suits) and runs', () => {
    expect(groupInfo(cards('7H', '7S', '7D'), rules())).toEqual({ kind: 'set', pure: false });
    expect(groupInfo(cards('3H', '4H', '5H'), rules())).toEqual({ kind: 'run', pure: true });
    expect(groupInfo(cards('7H', "7H'", '7D'), rules())).toBeNull(); // two 7♥
    expect(groupInfo(cards('3H', '4H'), rules())).toBeNull(); // too short
    expect(groupInfo(cards('3H', '5H', '6S'), rules())).toBeNull();
  });

  it('lets jokers fill gaps and complete sets, which makes a run impure', () => {
    expect(groupInfo(cards('3H', 'JK', '5H'), rules())).toEqual({ kind: 'run', pure: false });
    expect(groupInfo(cards('3H', '4H', 'JK'), rules())).toEqual({ kind: 'run', pure: false });
    expect(groupInfo(cards('7H', 'JK', '7D'), rules())).toEqual({ kind: 'set', pure: false });
    expect(groupInfo(cards('3H', 'JK', '7H'), rules())).toBeNull(); // gap of three
    expect(groupInfo(cards('7H', '7S', '7D', '7C', 'JK'), rules())).toBeNull(); // set of five
  });

  it('treats a card of the wild rank as itself in a pure run, or as a wild card', () => {
    const fivesWild = rules('low', '5');
    expect(groupInfo(cards('4H', '5H', '6H'), fivesWild)).toEqual({ kind: 'run', pure: true });
    expect(groupInfo(cards('4H', '5S', '6H'), fivesWild)).toEqual({ kind: 'run', pure: false });
    expect(groupInfo(cards('9C', '5S', '9D'), fivesWild)).toEqual({ kind: 'set', pure: false });
  });

  it('plays aces low, high, or either (but not round the corner)', () => {
    const low = cards('AH', '2H', '3H');
    const high = cards('QH', 'KH', 'AH');
    const corner = cards('KH', 'AH', '2H');
    expect(groupInfo(low, rules('low'))).not.toBeNull();
    expect(groupInfo(high, rules('low'))).toBeNull();
    expect(groupInfo(high, rules('high'))).not.toBeNull();
    expect(groupInfo(low, rules('high'))).toBeNull();
    expect(groupInfo(low, rules('both'))).not.toBeNull();
    expect(groupInfo(high, rules('both'))).not.toBeNull();
    expect(groupInfo(corner, rules('both'))).toBeNull();
  });

  it('checks cards added to melds on the table', () => {
    expect(canAddToMeld(cards('5H', '6H', '7H'), card('8H'), rules())).toBe(true);
    expect(canAddToMeld(cards('5H', '6H', 'JK'), card('4H'), rules())).toBe(true);
    expect(canAddToMeld(cards('5H', '6H', '7H'), card('9H'), rules())).toBe(false);
    expect(canAddToMeld(cards('9C', '9D', '9S'), card('9H'), rules())).toBe(true);
  });
});

describe('bestArrangement', () => {
  it('leaves the fewest points over', () => {
    // 7♥ could join the set or the run; the run (5-6-7-8♥) plus the set of 9s leaves only the K.
    const hand = cards('5H', '6H', '7H', '8H', '9C', '9D', '9S', 'KS');
    const best = bestArrangement(hand, rules(), value, false);
    expect(best.deadwood).toBe(10);
    expect(show(best.groups)).toEqual(['5H 6H 7H 8H', '9C 9D 9S']);
  });

  it('chooses which meld a shared card goes in', () => {
    // 7♥ 7♠ 7♦ and 5♥ 6♥ 7♥ both want the 7♥: the set plus 5♥ 6♥ left over is worse.
    const hand = cards('5H', '6H', '7H', '7S', '7D', '7C');
    const best = bestArrangement(hand, rules(), value, false);
    expect(best.deadwood).toBe(0);
    expect(show(best.groups)).toEqual(['5H 6H 7H', '7S 7D 7C']);
  });

  it('uses wild cards where they save the most', () => {
    const hand = cards('KH', 'KS', 'JK', '2C', '3C', 'QD');
    const best = bestArrangement(hand, rules(), value, false);
    // The joker completes the kings (saving 20) rather than 2-3♣ (saving 5).
    expect(best.deadwood).toBe(15);
  });

  it('counts every card when a needed pure run is missing', () => {
    const hand = cards('KH', 'KS', 'JK', '2C', '3C', 'QD');
    const best = bestArrangement(hand, rules(), value, true);
    expect(best.deadwood).toBe(35);
    // Fixing the pure run: 2-3-4♣ is pure, so the joker can still complete the kings.
    const fixed = bestArrangement(cards('KH', 'KS', 'JK', '2C', '3C', '4C'), rules(), value, true);
    expect(fixed.deadwood).toBe(0);
  });

  it('can use a wild-rank card as itself to make the pure run', () => {
    const hand = cards('4H', '5H', '6H', '9C', '9D', '5S');
    const best = bestArrangement(hand, rules('low', '5'), value, true);
    expect(best.deadwood).toBe(0);
    expect(show(best.groups)).toEqual(['4H 5H 6H', '9C 9D 5S']);
  });

  it('handles a 14-card hand from two decks quickly', { timeout: 2000 }, () => {
    const hand = cards(
      'AH',
      '2H',
      '3H',
      '4H',
      '7S',
      "7S'",
      '7D',
      '7C',
      'JK',
      '9D',
      '10D',
      'QD',
      'KC',
      "KC'",
    );
    const best = bestArrangement(hand, rules('both', '9'), value, true);
    // A-2-3-4♥ (pure), 7♠ 7♦ 7♣ and 10♦-wild-Q♦ leave the other 7♠ and both K♣ (27);
    // spending both wild cards on a set of kings instead would leave 37.
    expect(best.deadwood).toBe(27);
  });
});
