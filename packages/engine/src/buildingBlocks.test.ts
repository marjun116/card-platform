/**
 * Building blocks that the fixture games don't use: declared trump, passing a
 * bid, picking up a pile, skip/reverse, breakSuit, phase conditions, turn
 * orders and ending a round when a pile runs out.
 */
import { describe, expect, it } from 'vitest';
import { tinyTricks } from './__fixtures__/games';
import { hand, id, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves } from './api';
import type { Move } from './game/move';
import type { GameFile } from './game/types';

const trick = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});

describe('bidding, passing and declared trump', () => {
  const trumpGame: GameFile = {
    ...tinyTricks,
    meta: { name: 'Trump', players: 2 },
    cardOrder: { ranks: ['2', '3', '4', '5'], trump: 'declared' },
    phases: [
      {
        name: 'auction',
        rounds: 1,
        actions: [{ type: 'bid', values: [1, 2] }, { type: 'passBid' }],
      },
      {
        name: 'trump',
        order: 'dealer',
        until: 'state.trump != null',
        actions: [{ type: 'declareTrump', suits: ['spades', 'hearts'] }],
      },
      {
        name: 'play',
        leader: { first: 'leftOfDealer', then: 'lastTrickWinner' },
        actions: [{ type: 'playToTrick' }],
        afterTrick: [
          { resolveTrick: 'highestTrumpElseHighestLed' },
          { moveTrick: 'won', of: 'winner' },
          { winnerLeads: true },
          { breakSuit: 'hearts', if: "trick.containsSuit('hearts')" },
        ],
      },
    ],
  };

  it('offers bids and a pass, then lets the dealer name trump', () => {
    const state = createGame(trumpGame, {}, 2, 'trump');
    const D = state.dealer;
    const L = 1 - D;
    expect(getLegalMoves(state, L)).toEqual([
      { player: L, type: 'bid', value: 1 },
      { player: L, type: 'bid', value: 2 },
      { player: L, type: 'passBid' },
    ]);
    const bid = play(state, { player: L, type: 'passBid' }, { player: D, type: 'bid', value: 2 });
    expect(bid.players[L]?.bid).toBe('pass');
    expect(bid.cursor.current).toBe(D); // "order": "dealer"
    expect(getLegalMoves(bid, D)).toEqual([
      { player: D, type: 'declareTrump', suit: 'spades' },
      { player: D, type: 'declareTrump', suit: 'hearts' },
    ]);
    const declared = applyMove(bid, { player: D, type: 'declareTrump', suit: 'spades' });
    expect(declared.vars.trump).toBe('spades');
    expect(declared.file.phases[declared.cursor.phase]?.name).toBe('play');

    // L leads a heart; D has no hearts and trumps with the lowest spade.
    const dealt = withZones(
      declared,
      { [`hand@${L}`]: ['5H', '3H'], [`hand@${D}`]: ['2S', '4S'] },
      `won@${L}`,
    );
    const played = play(dealt, trick(L, '5H'), trick(D, '2S'));
    expect(played.lastTrick?.winner).toBe(D);
    expect(played.vars.heartsBroken).toBe(true);
    expect(played.cursor.current).toBe(D);
  });

  it('plays without trump until one is declared', () => {
    const noDeclare: GameFile = { ...trumpGame, phases: trumpGame.phases.slice(2) };
    const state = createGame(noDeclare, {}, 2, 'trump');
    const D = state.dealer;
    const L = 1 - D;
    const dealt = withZones(
      state,
      { [`hand@${L}`]: ['5H', '3H'], [`hand@${D}`]: ['2S', '4S'] },
      `won@${L}`,
    );
    const played = play(dealt, trick(L, '5H'), trick(D, '2S'));
    expect(played.lastTrick?.winner).toBe(L);
  });
});

describe('turn control', () => {
  const turns: GameFile = {
    meta: { name: 'Turns', players: 4 },
    deck: {},
    zones: {
      hand: { per: 'player', visibility: 'owner' },
      pile: { shared: true, visibility: 'all' },
      box: { shared: true, visibility: 'none' },
    },
    setup: { deal: { to: 'hand', count: 3 }, rest: 'box' },
    phases: [
      {
        name: 'play',
        until: 'pile.count >= 6',
        actions: [
          {
            type: 'play',
            to: 'pile',
            effects: [
              { if: "card.rank == 'K'", skip: true },
              { if: "card.rank == 'Q'", reverse: true },
              { if: "card.rank == 'J'", nextPlayer: { skip: true } },
            ],
          },
        ],
      },
    ],
    scoring: { perPlayer: [{ add: 'hand.count' }] },
    endCondition: { when: 'true', winner: 'lowestScore', ties: 'share' },
  };

  function table(hands: string[][]) {
    const base = createGame(turns, {}, 4, 'turns');
    const first = base.cursor.current;
    const seats = [0, 1, 2, 3].map((i) => (first + i) % 4);
    const zones = Object.fromEntries(seats.map((s, i) => [`hand@${s}`, hands[i] ?? []]));
    return { state: withZones(base, zones, 'box'), seats };
  }
  const put = (player: number, spec: string): Move => ({
    player,
    type: 'play',
    card: id(spec),
    to: 'pile',
  });

  it('goes clockwise by default', () => {
    const { state, seats } = table([['2C'], ['3C'], ['4C'], ['5C']]);
    expect(applyMove(state, put(seats[0] ?? 0, '2C')).cursor.current).toBe(seats[1]);
  });

  it('skip passes over the next player', () => {
    const { state, seats } = table([['KC'], ['3C'], ['4C'], ['5C']]);
    expect(applyMove(state, put(seats[0] ?? 0, 'KC')).cursor.current).toBe(seats[2]);
  });

  it('nextPlayer can skip too', () => {
    const { state, seats } = table([['JC'], ['3C'], ['4C'], ['5C']]);
    expect(applyMove(state, put(seats[0] ?? 0, 'JC')).cursor.current).toBe(seats[2]);
  });

  it('reverse turns play around', () => {
    const { state, seats } = table([['QC'], ['3C'], ['4C'], ['5C']]);
    const next = applyMove(state, put(seats[0] ?? 0, 'QC'));
    expect(next.cursor.direction).toBe(-1);
    expect(next.cursor.current).toBe(seats[3]);
    expect(applyMove(next, put(seats[3] ?? 0, '5C')).cursor.current).toBe(seats[2]);
  });

  it('starts right of the dealer and goes the other way for counterclockwise phases', () => {
    const ccw: GameFile = {
      ...turns,
      phases: [{ ...(turns.phases[0] as GameFile['phases'][number]), order: 'counterclockwise' }],
    };
    const state = createGame(ccw, {}, 4, 'ccw');
    expect(state.cursor.current).toBe((state.dealer + 3) % 4);
    expect(state.cursor.direction).toBe(-1);
  });
});

describe('piles and phase conditions', () => {
  const pile: GameFile = {
    meta: { name: 'Pile', players: 2 },
    deck: { ranks: ['2', '3', '4', '5'], suits: ['clubs'] },
    zones: {
      hand: { per: 'player', visibility: 'owner' },
      stock: { shared: true, visibility: 'none' },
      pile: { shared: true, visibility: 'all' },
    },
    setup: { shuffle: false, deal: { to: 'hand', count: 0 }, rest: 'stock' },
    phases: [
      { name: 'later', if: 'round > 1', rounds: 1, actions: [{ type: 'passBid' }] },
      {
        name: 'take',
        actions: [
          { type: 'pickUpPile', from: 'pile' },
          { type: 'draw', from: 'stock' },
        ],
        whenEmpty: { stock: 'endRound' },
      },
    ],
    scoring: { perPlayer: [{ add: 'hand.count' }] },
    endCondition: { when: 'round >= 2', winner: 'highestScore', ties: 'share' },
  };

  it('skips a phase whose condition is false', () => {
    const state = createGame(pile, {}, 2, 'pile');
    expect(state.file.phases[state.cursor.phase]?.name).toBe('take');
  });

  it('picks up a whole pile', () => {
    const base = createGame(pile, {}, 2, 'pile');
    const state = withZones(base, { pile: ['2C', '3C'] }, 'stock');
    const me = state.cursor.current;
    expect(getLegalMoves(state, me)).toContainEqual({
      player: me,
      type: 'pickUpPile',
      from: 'pile',
    });
    const next = applyMove(state, { player: me, type: 'pickUpPile', from: 'pile' });
    expect(hand(next, me)).toEqual([id('2C'), id('3C')]);
    expect(next.zones.pile).toEqual([]);
  });

  it('ends the round when a pile with "endRound" runs out', () => {
    let state = createGame(pile, {}, 2, 'pile');
    for (let i = 0; i < 4; i++) {
      state = applyMove(state, { player: state.cursor.current, type: 'draw', from: 'stock' });
    }
    // Four cards drawn, stock empty: round 1 is over and round 2 starts with the "later" phase.
    expect(state.round).toBe(2);
    expect(state.file.phases[state.cursor.phase]?.name).toBe('later');
    expect(state.teams.map((t) => t.score)).toEqual([2, 2]);
  });
});
