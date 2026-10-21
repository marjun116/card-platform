/**
 * Scenario tests for crazy-eights.json: the rules a real table would check.
 * Each test deals exact hands and a starting card; seats are numbered from
 * the first player (left of the dealer) as a, b, c.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
  type Suit,
  viewFor,
} from '@card-table/engine';
import { card as cardOf, hand, id, play, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const eights = builtInGames['crazy-eights'];
type Options = Record<string, OptionValue>;

const types = (state: GameState, seat: number) =>
  [...new Set(getLegalMoves(state, seat).map((m) => m.type))].sort();
const playable = (state: GameState, seat: number) =>
  getLegalMoves(state, seat)
    .flatMap((m) => (m.type === 'play' ? [m.card] : []))
    .sort();
const ids = (...specs: string[]) => specs.map(id).sort();
const suitOf = (spec: string) => (cardOf(spec) as { suit: Suit }).suit;
const score = (state: GameState, seat: number) => state.teams[seat]?.score;

/**
 * A game where the players, from the first player round the table, hold
 * exactly these hands, with `top` face up on the discard pile. The rest of
 * the deck is the stock, unless `stock` is given (its last card is drawn first).
 */
function table(hands: string[][], top: string, options: Options = {}, stock?: string[]) {
  const base = createGame(eights, options, hands.length, 'eights');
  const first = base.cursor.current;
  const seat = (i: number) => (first + i) % hands.length;
  const zones: Record<string, string[]> = { discard: [top] };
  hands.forEach((h, i) => (zones[`hand@${seat(i)}`] = h));
  if (stock) zones.stock = stock;
  // Leftover cards go to the stock, or under the discard pile when the stock is given.
  const state = withZones(base, zones, stock ? 'discard' : 'stock');
  state.vars.activeSuit = suitOf(top);
  state.vars.penalty = 0;
  const [a, b, c] = [seat(0), seat(1), seat(2)];
  const playCard = (player: number, spec: string): Move => ({
    player,
    type: 'play',
    card: id(spec),
    to: 'discard',
  });
  return { state, a, b, c, playCard };
}
const draw = (player: number): Move => ({ player, type: 'draw', from: 'stock' });

describe('crazy eights: the deal', () => {
  const cards = (state: GameState) => Object.values(state.zones).flat().length;

  it('deals 7 each to two players and 5 each to more, from one deck', () => {
    const two = createGame(eights, {}, 2, 'deal');
    expect(hand(two, 0)).toHaveLength(7);
    expect(cards(two)).toBe(52);
    const seven = createGame(eights, {}, 7, 'deal');
    expect(hand(seven, 0)).toHaveLength(5);
    expect(cards(seven)).toBe(52);
  });

  it('uses two decks for 8 to 10 players, or when big hands would run one dry', () => {
    expect(cards(createGame(eights, {}, 8, 'deal'))).toBe(104);
    expect(cards(createGame(eights, {}, 10, 'deal'))).toBe(104);
    const sixBig = createGame(eights, { cards: 8 }, 6, 'deal');
    expect(hand(sixBig, 0)).toHaveLength(8);
    expect(cards(sixBig)).toBe(104);
  });

  it('never starts the pile with an 8, unless that house rule says it counts', () => {
    const tops = (options: Options) =>
      Array.from({ length: 60 }, (_, i) => {
        const state = createGame(eights, options, 3, `starter-${i}`);
        return { top: state.zones.discard?.at(-1), suit: state.vars.activeSuit };
      });
    expect(tops({}).some(({ top }) => top && 'rank' in top && top.rank === '8')).toBe(false);
    const counted = tops({ starterEight: 'counts' }).filter(
      ({ top }) => top && 'rank' in top && top.rank === '8',
    );
    expect(counted.length).toBeGreaterThan(0);
    for (const { top, suit } of counted) expect(suit).toBe(top && 'suit' in top ? top.suit : null);
  });
});

describe('crazy eights: playing', () => {
  it('allows a card matching the suit or rank, or any 8', () => {
    const { state, a } = table([['5S', 'KD', '8H', '2H'], ['3C']], 'KS');
    expect(playable(state, a)).toEqual(ids('5S', 'KD', '8H'));
  });

  it('lets the player of an 8 name the suit, which the next player must follow', () => {
    const { state, a, b, playCard } = table(
      [
        ['8D', '3C'],
        ['2H', '5C', '8C'],
      ],
      'KS',
    );
    const played = applyMove(state, playCard(a, '8D'));
    expect(getLegalMoves(played, a).map((m) => m.type)).toEqual(Array(4).fill('chooseSuit'));
    const chosen = applyMove(played, { player: a, type: 'chooseSuit', suit: 'hearts' });
    expect(playable(chosen, b)).toEqual(ids('2H', '8C'));
  });

  it('shows the suit named for an 8 on the table, once it has been named', () => {
    const { state, a, b, playCard } = table(
      [
        ['8D', '3C'],
        ['2H', '5C', '8C'],
      ],
      'KS',
    );
    expect(viewFor(state, b).display).toEqual([]);
    const played = applyMove(state, playCard(a, '8D'));
    expect(viewFor(played, b).display).toEqual([]);
    const chosen = applyMove(played, { player: a, type: 'chooseSuit', suit: 'hearts' });
    expect(viewFor(chosen, b).display).toEqual([
      { label: 'Suit to play', value: 'hearts', format: 'suit' },
    ]);
    // Gone once a card other than an 8 is on top.
    expect(viewFor(applyMove(chosen, playCard(b, '2H')), a).display).toEqual([]);
  });

  it("doesn't ask for a suit when the 8 is the last card", () => {
    const { state, a, playCard } = table([['8D'], ['2H', '5C']], 'KS');
    const out = applyMove(state, playCard(a, '8D'));
    expect(out.pending).toBeNull();
    expect(out.round).toBe(2);
  });
});

describe('crazy eights: drawing', () => {
  it('draws until a card can be played, and may draw even when able to play', () => {
    const { state, a } = table([['2H'], ['4C']], 'KS', {}, ['9D', '3S', '6D']);
    expect(types(state, a)).toEqual(['draw']);
    const once = applyMove(state, draw(a)); // the 6♦: still nothing to play
    expect(types(once, a)).toEqual(['draw']);
    const twice = applyMove(once, draw(a)); // the 3♠
    expect(types(twice, a)).toEqual(['draw', 'play']);
  });

  it('passes when the stock is empty and nothing can be played', () => {
    const { state, a, b, playCard } = table(
      [
        ['5S', '2H'],
        ['3H', '4C'],
      ],
      'KS',
      {},
      [],
    );
    // After the 5♠, b can't play or draw, and neither can a: the hand is blocked.
    const after = applyMove(state, playCard(a, '5S'));
    expect(after.round).toBe(2);
    // a's 2 is the lowest hand and collects the difference: (2 + 7) - 2 × 2 = 5.
    expect(score(after, a)).toBe(5);
    expect(score(after, b)).toBe(0);
  });

  it('reshuffles the discard pile into the stock with that house rule', () => {
    const { state, a, b, playCard } = table(
      [
        ['5S', '2H'],
        ['3H', '4C'],
      ],
      'KS',
      { reshuffle: true },
      [],
    );
    const after = applyMove(state, playCard(a, '5S'));
    expect(after.cursor.current).toBe(b);
    expect(types(after, b)).toEqual(['draw']);
    const drawn = applyMove(after, draw(b));
    expect(drawn.zones.discard?.map((c) => c.id)).toEqual([id('5S')]);
  });

  describe('"Draw one card; play it if you can"', () => {
    const options = { drawing: 'one' };

    it("is only offered when you can't play", () => {
      const { state, a } = table([['2H', '5S'], ['4C']], 'KS', options);
      expect(types(state, a)).toEqual(['play']);
    });

    it('lets you play the drawn card or keep it', () => {
      const { state, a } = table([['2H'], ['4C']], 'KS', options, ['9D', '3S']);
      const drawn = applyMove(state, draw(a));
      expect(getLegalMoves(drawn, a)).toEqual([
        { player: a, type: 'play', card: id('3S'), to: 'discard' },
        { player: a, type: 'endTurn' },
      ]);
    });

    it('ends your turn if the drawn card can’t be played', () => {
      const { state, a, b } = table([['2H'], ['4C']], 'KS', options, ['3S', '9D']);
      const drawn = applyMove(state, draw(a));
      expect(drawn.cursor.current).toBe(b);
      expect(hand(drawn, a)).toHaveLength(2);
    });
  });

  it('stops after three draws with "Draw up to 3 cards, then pass"', () => {
    const { state, a, b } = table([['2H'], ['4C']], 'KS', { drawing: 'upToThree' }, [
      '3S',
      '4D',
      '5D',
      '6D',
    ]);
    const drawn = play(state, draw(a), draw(a), draw(a));
    // Still nothing to play and no more draws: the turn passes.
    expect(drawn.cursor.current).toBe(b);
    expect(hand(drawn, a)).toHaveLength(4);
  });
});

describe('crazy eights: scoring and the end of the game', () => {
  const leftover = ['8C', 'KD', 'AS', '7H']; // 50 + 10 + 1 + 7 = 68

  it('gives the player who goes out the value of every card left in other hands', () => {
    const { state, a, b, c, playCard } = table([['5S'], leftover, ['2D']], 'KS');
    const out = applyMove(state, playCard(a, '5S'));
    expect(score(out, a)).toBe(70);
    expect([score(out, b), score(out, c)]).toEqual([0, 0]);
    expect(out.status).toBe('inProgress'); // 70 is short of 100
  });

  it('ends at the target score, highest winning', () => {
    const { state, a, playCard } = table([['5S'], leftover, ['8D', 'QD']], 'KS');
    const out = applyMove(state, playCard(a, '5S'));
    expect(out.status).toBe('over');
    expect(out.winners).toEqual([a]);
  });

  it('scores everyone’s own cards against them with penalty scoring, lowest winning', () => {
    const options = { scoring: 'penalty' };
    const { state, a, b, playCard } = table([['5S'], leftover], 'KS', options);
    const out = applyMove(state, playCard(a, '5S'));
    expect(score(out, a)).toBe(0);
    expect(score(out, b)).toBe(68);
    const oneHand = table([['5S'], leftover], 'KS', { ...options, targetScore: 'oneHand' });
    const over = applyMove(oneHand.state, oneHand.playCard(oneHand.a, '5S'));
    expect(over.status).toBe('over');
    expect(over.winners).toEqual([oneHand.a]);
  });
});

describe('crazy eights: special cards', () => {
  it('makes the next player draw 2 and miss a turn on a 2', () => {
    const { state, a, b, c, playCard } = table([['2S', '3C'], ['4H'], ['5H']], 'KS', {
      drawTwo: true,
    });
    const after = applyMove(state, playCard(a, '2S'));
    expect(hand(after, b)).toHaveLength(3);
    expect(after.cursor.current).toBe(c);
  });

  it('stacks 2s: the next player plays a 2 or draws the total', () => {
    const options = { drawTwo: true, stackTwos: true };
    const { state, a, b, c, playCard } = table([['2S', '3C'], ['2H', '5S'], ['9C']], 'KS', options);
    const first = applyMove(state, playCard(a, '2S'));
    expect(first.cursor.current).toBe(b);
    // The 5♠ matches, but with 2 to draw only another 2 (or drawing) is allowed.
    expect(playable(first, b)).toEqual(ids('2H'));
    expect(types(first, b)).toEqual(['draw', 'play']);

    const second = applyMove(first, playCard(b, '2H'));
    expect(second.vars.penalty).toBe(4);
    expect(getLegalMoves(second, c)).toEqual([{ player: c, type: 'draw', from: 'stock' }]);
    const drawn = applyMove(second, draw(c));
    expect(hand(drawn, c)).toHaveLength(5);
    expect(drawn.vars.penalty).toBe(0);
    expect(drawn.cursor.current).toBe(a);
  });

  it("lets play go on normally when stacked 2s can't be drawn", () => {
    const options = { drawTwo: true, stackTwos: true };
    const { state, a, b, playCard } = table(
      [
        ['2S', '3C'],
        ['5S', '9H'],
      ],
      'KS',
      options,
      [],
    );
    const first = applyMove(state, playCard(a, '2S'));
    expect(playable(first, b)).toEqual(ids('5S'));
    expect(applyMove(first, playCard(b, '5S')).vars.penalty).toBe(0);
  });

  it('skips the next player on a jack', () => {
    const { state, a, c, playCard } = table([['JS', '3C'], ['4H'], ['5H']], 'KS', {
      jacksSkip: true,
    });
    expect(applyMove(state, playCard(a, 'JS')).cursor.current).toBe(c);
  });

  it('reverses direction on an ace, or skips with two players', () => {
    const three = table([['AS', '3C'], ['4H'], ['5H']], 'KS', { acesReverse: true });
    const reversed = applyMove(three.state, three.playCard(three.a, 'AS'));
    expect(reversed.cursor.current).toBe(three.c);
    expect(reversed.cursor.direction).toBe(-1);

    const two = table([['AS', '3C'], ['4H']], 'KS', { acesReverse: true });
    expect(applyMove(two.state, two.playCard(two.a, 'AS')).cursor.current).toBe(two.a);
  });

  it('makes the next player draw 5 and miss a turn on the queen of spades', () => {
    const { state, a, b, c, playCard } = table([['QS', '3C'], ['4H'], ['5H']], 'KS', {
      queenOfSpades: true,
    });
    const after = applyMove(state, playCard(a, 'QS'));
    expect(hand(after, b)).toHaveLength(6);
    expect(after.cursor.current).toBe(c);
  });

  it('does nothing special with the house rules off', () => {
    const { state, a, b, playCard } = table([['2S', 'JS', '3C'], ['4H'], ['5H']], 'KS');
    const after = applyMove(state, playCard(a, '2S'));
    expect(hand(after, b)).toHaveLength(1);
    expect(after.cursor.current).toBe(b);
  });
});
