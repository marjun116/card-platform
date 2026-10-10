/**
 * The shedding, melding and counting bots, and the helpers bots share, on
 * the engine's own small test games.
 */
import { describe, expect, it } from 'vitest';
import { counting, miniRummy, passing, sevensUp, spades, wildRummy } from '../__fixtures__/games';
import { applyMove, createGame, getLegalMoves } from '../api';
import { type Card, suitedCard } from '../cards/card';
import type { Move } from '../game/move';
import type { GameState } from '../game/state';
import type { GameFile, OptionValue } from '../game/types';
import { botStrategy, id, simulateMany, withZones } from '../testing';
import { choose, bidNearest, discardLowest, lowestBid, passLow } from './choices';
import { countingPlay, handScore } from './cribbage';
import { askBot, botInput, botSeat } from './input';
import { meldingPlay } from './melds';
import { sheddingPlay } from './shedding';
import { cardPoints, deckOf, estimateTricks, isMaster, trickRules } from './table';
import { longestSuit, passHigh, strongestTrump } from './tricks';
import { type Bot, type BotPart, combineBots } from './types';

/** What a bot part decides for whoever is due to move. */
function decide(state: GameState, part: BotPart): Move | null {
  const seat = state.pending?.player ?? state.cursor.current;
  return part(botInput(state, seat, getLegalMoves(state, seat), () => 0));
}

const card = (move: Move | null) => (move && 'card' in move ? move.card : null);

describe('shedding bots', () => {
  const shed = sheddingPlay({ wild: (c) => 'rank' in c && c.rank === '7' });

  it('play the costliest card that isn’t wild, and keep wild cards back', () => {
    const start = createGame(sevensUp, {}, 2, 'shed');
    const seat = start.cursor.current;
    const top = start.zones.discard?.at(-1) as Card & { suit: string };
    const suit = top.suit[0]?.toUpperCase() as string;
    const s = withZones(start, { [`hand@${seat}`]: [`2${suit}`, `K${suit}`, '7C'] }, 'stock');
    const s2 = { ...s, vars: { ...s.vars, activeSuit: top.suit } };
    expect(card(decide(s2, shed))).toBe(id(`K${suit}`));
  });

  it('draw when nothing plays, and name the suit they hold most of', () => {
    const start = createGame(sevensUp, {}, 2, 'shed-2');
    const seat = start.cursor.current;
    const s = withZones(start, { [`hand@${seat}`]: [] }, 'stock');
    const draw = decide(s, shed);
    expect(draw?.type).toBe('draw');
    // A seven played: choose the suit with most cards.
    const hand = ['7S', '2H', '3H', '4H', '5C'];
    const s2 = withZones(start, { [`hand@${seat}`]: hand }, 'stock');
    const after = applyMove(s2, { player: seat, type: 'play', card: id('7S'), to: 'discard' });
    expect(decide(after, shed)).toMatchObject({ type: 'chooseSuit', suit: 'hearts' });
  });

  it('play whole games', { timeout: 60_000 }, () => {
    const report = simulateMany(sevensUp, { games: 10, strategy: botStrategy(combineBots(shed)) });
    expect(report.games).toBe(10);
  });
});

describe('melding bots', () => {
  const meld = combineBots(meldingPlay());

  it('take a discard only when it completes a meld', () => {
    const start = createGame(wildRummy, { jokers: false, cut: false }, 2, 'meld');
    const seat = start.cursor.current;
    const take = withZones(
      start,
      { [`hand@${seat}`]: ['5C', '5D', '9H'], discard: ['5S'] },
      'stock',
    );
    expect(decide(take, meldingPlay())).toMatchObject({ type: 'draw', from: 'discard' });
    const leave = withZones(
      start,
      { [`hand@${seat}`]: ['5C', '8D', '9H'], discard: ['5S'] },
      'stock',
    );
    expect(decide(leave, meldingPlay())).toMatchObject({ type: 'draw', from: 'stock' });
  });

  it('sort their hand after drawing, then keep melds and discard the costliest loose card', () => {
    const start = createGame(wildRummy, { jokers: false, cut: false }, 2, 'meld-2');
    const seat = start.cursor.current;
    let s = withZones(
      start,
      { [`hand@${seat}`]: ['5C', '5D', '5H', '2S', 'KD'], stock: ['3C'] },
      'discard',
    );
    s = applyMove(s, { player: seat, type: 'draw', from: 'stock' });
    const arrange = decide(s, meldingPlay());
    expect(arrange?.type).toBe('arrange');
    s = applyMove(s, arrange as Move);
    const next = decide(s, meldingPlay());
    // The three fives are a meld: melding, laying off or discarding the king all fit.
    if (next?.type === 'discard') expect(next.card).toBe(id('KD'));
    else expect(['meld', 'layOff', 'showHand']).toContain(next?.type);
  });

  it('play whole games, with and without the sort button', { timeout: 60_000 }, () => {
    const variants: Record<string, OptionValue>[] = [{}, { sort: false }];
    for (const options of variants) {
      const report = simulateMany(wildRummy, {
        games: 5,
        strategy: botStrategy(meld),
        options,
        seedPrefix: `meld-${JSON.stringify(options)}`,
      });
      expect(report.games).toBe(5);
    }
  });

  it('play games without arranged hands too (no sorted groups)', { timeout: 60_000 }, () => {
    const report = simulateMany(miniRummy, {
      games: 3,
      strategy: botStrategy(meld),
      options: { reshuffles: 1 },
    });
    expect(report.games).toBe(3);
  });
});

describe('counting bots', () => {
  it('score a hand: fifteens, pairs, runs and a flush', () => {
    const cards = (...codes: string[]) =>
      codes.map((c) =>
        suitedCard(
          c.slice(0, -1) as never,
          ({ C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' } as const)[c.slice(-1) as 'C'],
        ),
      );
    // 5-5-5-J: four fifteens (8) and three pairs (6).
    expect(handScore(counting, cards('5C', '5D', '5H', 'JS'))).toBe(14);
    // A run of four in one suit: 4 for the run, 4 for the flush.
    expect(handScore(counting, cards('AH', '2H', '3H', '4H'))).toBe(8);
  });

  it('peg the most points: a pair, then avoiding the risky counts', () => {
    const play = countingPlay({ keep: () => 3, pile: 'pile', count: 'total' });
    const start = createGame(counting, {}, 2, 'count');
    const first = start.cursor.current;
    const second = (first + 1) % 2;
    let s = withZones(
      start,
      { [`hand@${first}`]: ['4C', '9D', 'QH'], [`hand@${second}`]: ['4D', 'AS', 'KS'] },
      'stock',
    );
    s = applyMove(s, { player: first, type: 'play', card: id('4C'), to: 'pile' });
    expect(card(decide(s, play))).toBe(id('4D'));
  });

  it('keep the best cards when throwing some away', () => {
    // A tiny crib game: each player throws one of four cards, keeping three.
    const crib: GameFile = {
      ...counting,
      zones: { ...counting.zones, crib: { shared: true, visibility: 'none' } },
      setup: { ...counting.setup, deal: { to: 'hand', count: 4 } },
      phases: [
        { name: 'crib', rounds: 1, actions: [{ type: 'discard', to: 'crib' }] },
        ...counting.phases,
      ],
    };
    const start = createGame(crib, {}, 2, 'crib');
    const seat = start.cursor.current;
    const s = withZones(start, { [`hand@${seat}`]: ['5C', '5D', 'JS', '2H'] }, 'stock');
    const play = countingPlay({ keep: () => 3, pile: 'pile', count: 'total' });
    expect(card(decide(s, play))).toBe(id('2H'));
  });

  it('play whole games', { timeout: 60_000 }, () => {
    const bot = combineBots(countingPlay({ keep: () => 3, pile: 'pile', count: 'total' }));
    expect(simulateMany(counting, { games: 10, strategy: botStrategy(bot) }).games).toBe(10);
  });
});

describe('shared helpers', () => {
  it('pick named choices, bids near a target and the lowest bid', () => {
    const state = createGame(spades, {}, 4, 'helpers');
    const input = botInput(
      state,
      state.cursor.current,
      getLegalMoves(state, state.cursor.current),
      () => 0,
    );
    expect(bidNearest(input, 4.4)).toMatchObject({ type: 'bid', value: 4 });
    expect(lowestBid(input)).toMatchObject({ type: 'bid', value: 1 });
    expect(choose('nope')(input)).toBeNull();
    expect(lowestBid({ ...input, legal: [] })).toBeNull();
    expect(discardLowest(input)).toBeNull();
    expect(passLow(input)).toBeNull();
  });

  it('pass the weakest or strongest cards', () => {
    const state = createGame(passing, {}, 4, 'pass');
    const seat = state.cursor.current;
    const s = withZones(
      state,
      {
        [`hand@${seat}`]: [
          '2C',
          '3C',
          '4C',
          'AS',
          'KS',
          'QS',
          '9H',
          '8H',
          '7H',
          '6H',
          '5H',
          '4H',
          '3H',
        ],
      },
      'trick',
    );
    const low = decide(s, passLow);
    expect(low?.type === 'pass' ? [...low.cards].sort() : null).toEqual(
      [id('2C'), id('3C'), id('3H')].sort(),
    );
    const high = decide(s, passHigh());
    expect(high?.type === 'pass' ? [...high.cards].sort() : null).toEqual(
      [id('AS'), id('KS'), id('QS')].sort(),
    );
  });

  it('discard the weakest card', () => {
    const start = createGame(miniRummy, {}, 2, 'discard');
    const seat = start.cursor.current;
    let s = withZones(start, { [`hand@${seat}`]: ['KC', '2D', '9H'] }, 'stock');
    s = applyMove(s, { player: seat, type: 'draw', from: 'stock' });
    expect(card(decide(s, discardLowest))).toBe(id('2D'));
  });

  it('name the longest suit as trump', () => {
    const declared: GameFile = {
      ...spades,
      cardOrder: { ...spades.cardOrder, trump: 'declared' },
      phases: [
        { name: 'trump', rounds: 1, order: 'dealer', actions: [{ type: 'declareTrump' }] },
        ...spades.phases.slice(1),
      ],
    };
    const start = createGame(declared, {}, 4, 'trump');
    const seat = start.cursor.current;
    const s = withZones(start, { [`hand@${seat}`]: ['2D', '3D', '9D', 'AS', 'KH'] }, 'won@t0');
    expect(decide(s, strongestTrump)).toMatchObject({ type: 'declareTrump', suit: 'diamonds' });
    expect(longestSuit([], ['clubs'])).toBeNull();
  });

  it('read cards: points, the deck, sure tricks and unbeatable cards', () => {
    const c = (rank: string, suit: 'hearts' | 'spades') => suitedCard(rank as never, suit);
    expect(cardPoints(miniRummy, c('K', 'hearts'))).toBe(10);
    expect(cardPoints(miniRummy, c('7', 'hearts'))).toBe(7);
    expect(cardPoints(spades, c('A', 'hearts'))).toBe(1);
    expect(cardPoints(spades, { id: 'JOKER.0', joker: true })).toBe(0);
    expect(deckOf({ ...spades, deck: { copies: 'options.x' } })).toMatchObject({ copies: 1 });
    const state = createGame(spades, {}, 4, 'read');
    const rules = trickRules(spades, { ...viewOf(state), phase: 'play' });
    expect(estimateTricks(rules, [c('A', 'hearts'), c('K', 'spades'), c('Q', 'spades')])).toBe(1.7);
    const kh = c('K', 'hearts');
    expect(isMaster(spades, rules, kh, [], new Set())).toBe(false);
    expect(isMaster(spades, rules, kh, [], new Set(['AH.0']))).toBe(true);
    const twoDecks = { ...spades, deck: { copies: 2 } };
    expect(isMaster(twoDecks, rules, kh, [], new Set(['AH.0']))).toBe(false);
  });

  it('build a bot’s input and say which seat it’s choosing for', () => {
    const state = createGame(spades, {}, 4, 'input');
    const seat = state.cursor.current;
    const input = botInput(state, seat, getLegalMoves(state, seat), () => 0);
    expect(input.sortedGroups()).toBeNull();
    expect(botSeat([], 3)).toBe(3);
    expect(botSeat([{ player: 1, by: 2, type: 'passBid' }], 3)).toBe(2);
    const rummy = createGame(wildRummy, {}, 2, 'input-2');
    const groups = botInput(rummy, 0, [], () => 0).sortedGroups();
    expect(Array.isArray(groups)).toBe(true);
    const bot: Bot = ({ legal }) => legal[0] as Move;
    expect(askBot(bot, state, getLegalMoves(state, seat), () => 0)).toEqual(
      getLegalMoves(state, seat)[0],
    );
  });
});

function viewOf(state: GameState) {
  return botInput(state, 0, [], () => 0).view;
}
