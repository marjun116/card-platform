/**
 * Scenario tests for spades.json: the rules a real table would check.
 * Hands are dealt exactly, then moves are played through the engine.
 *
 * Seats are named by bidding order: a (left of the dealer), b, c, d.
 * Partnerships are a + c and b + d.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  viewFor,
} from '@card-table/engine';
import { id, play, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const spades = builtInGames.spades;
type Hands = [string[], string[], string[], string[]];
type Bids = [number | string, number | string, number | string, number | string];

const bid = (player: number, value: number | string): Move => ({ player, type: 'bid', value });
const look = (player: number): Move => ({ player, type: 'lookAtHand' });
const card = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});
const suit = (letter: string) =>
  ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((r) => r + letter);

/** A game where a, b, c and d hold exactly these hands. */
function deal(hands: Hands, options = {}) {
  const base = createGame(spades, options, 4, 'scenario');
  const a = (base.dealer + 1) % 4;
  const [b, c, d] = [(a + 1) % 4, (a + 2) % 4, (a + 3) % 4];
  const zones = Object.fromEntries([a, b, c, d].map((seat, i) => [`hand@${seat}`, hands[i] ?? []]));
  return { state: withZones(base, zones), a, b, c, d };
}

/** Everyone bids in turn from a, looking first unless bidding blind nil. */
function bidAll(state: GameState, bids: Bids): GameState {
  const a = (state.dealer + 1) % 4;
  return play(
    state,
    ...[0, 1, 2, 3].flatMap((i) => {
      const seat = (a + i) % 4;
      const value = bids[i] as number | string;
      const needsLook = state.lookRequired && value !== 'blindNil';
      return needsLook ? [look(seat), bid(seat, value)] : [bid(seat, value)];
    }),
  );
}

/** Plays out the round with each player's first legal card. */
function finishRound(state: GameState): GameState {
  let s = state;
  const round = s.round;
  while (s.round === round && s.status === 'inProgress') {
    const move = getLegalMoves(s, s.cursor.current).find((m) => m.type !== 'lookAtHand');
    if (!move) throw new Error('stuck');
    s = applyMove(s, move);
  }
  return s;
}

const teamOf = (state: GameState, seat: number) => state.teams[state.players[seat]?.team ?? 0];

// a holds every club, b every diamond, c every heart, d every spade. Whatever is
// led, d wins with a spade, so team b + d takes all 13 tricks.
const ONE_SUIT_EACH: Hands = [suit('C'), suit('D'), suit('H'), suit('S')];

// Everyone holds some of each suit.
const MIXED: Hands = [
  ['2C', '3C', '4C', 'AC', '2D', '3D', '4D', '2H', '3H', '4H', '5H', '6H', '2S'],
  ['5C', '6C', '7C', '5D', '6D', '7D', '7H', '8H', '9H', '10H', '3S', '4S', '5S'],
  ['8C', '9C', '10C', '8D', '9D', '10D', 'JD', 'JH', 'QH', 'KH', '6S', '7S', '8S'],
  ['JC', 'QC', 'KC', 'QD', 'KD', 'AD', 'AH', '9S', '10S', 'JS', 'QS', 'KS', 'AS'],
];

describe('spades: leading spades', () => {
  it("can't lead a spade before spades are broken", () => {
    const { state, a } = deal(MIXED);
    const leads = getLegalMoves(bidAll(state, [3, 3, 3, 3]), a);
    expect(leads).toHaveLength(12);
    expect(leads).not.toContainEqual(card(a, '2S'));
  });

  it('can lead a spade when holding nothing else', () => {
    const { state, a } = deal([suit('S'), suit('C'), suit('D'), suit('H')]);
    expect(getLegalMoves(bidAll(state, [3, 3, 3, 3]), a)).toHaveLength(13);
  });

  it('stays unbroken while nobody plays a spade', () => {
    const { state, a, b, c, d } = deal(MIXED);
    const s = play(
      bidAll(state, [3, 3, 3, 3]),
      card(a, '2H'),
      card(b, '7H'),
      card(c, 'JH'),
      card(d, 'AH'),
    );
    expect(s.lastTrick?.winner).toBe(d);
    expect(s.vars.spadesBroken).toBeUndefined();
    // d now leads, holding six non-spades and six spades: only the non-spades are allowed.
    expect(getLegalMoves(s, d)).toHaveLength(6);
  });

  it('breaks when a player out of the led suit trumps with a spade', () => {
    const { state, a, b, c, d } = deal(ONE_SUIT_EACH);
    const s = play(
      bidAll(state, [3, 3, 3, 3]),
      card(a, '2C'),
      card(b, '2D'),
      card(c, '2H'),
      card(d, '2S'),
    );
    expect(s.lastTrick?.winner).toBe(d);
    expect(s.vars.spadesBroken).toBe(true);
    expect(getLegalMoves(s, d)).toContainEqual(card(d, '3S'));
  });
});

describe('spades: following suit', () => {
  it('must follow the led suit when possible', () => {
    const { state, a, b } = deal(MIXED);
    const s = play(bidAll(state, [3, 3, 3, 3]), card(a, '2C'));
    expect(getLegalMoves(s, b)).toEqual([card(b, '5C'), card(b, '6C'), card(b, '7C')]);
    expect(() => applyMove(s, card(b, '3S'))).toThrow("isn't legal");
  });

  it('may play anything when out of the led suit', () => {
    const { state, a, b } = deal(ONE_SUIT_EACH);
    const s = play(bidAll(state, [3, 3, 3, 3]), card(a, '2C'));
    expect(getLegalMoves(s, b)).toHaveLength(13);
  });

  it('gives the trick to the highest card of the led suit; the winner leads next', () => {
    const { state, a, b, c, d } = deal(MIXED);
    const s = play(
      bidAll(state, [3, 3, 3, 3]),
      card(a, 'AC'),
      card(b, '5C'),
      card(c, '10C'),
      card(d, 'KC'),
    );
    expect(s.lastTrick?.winner).toBe(a);
    expect(s.cursor.current).toBe(a);
  });
});

describe('spades: scoring', () => {
  it('scores a made bid plus overtricks, which count as bags', () => {
    const { state, a, d } = deal(ONE_SUIT_EACH);
    const s = finishRound(bidAll(state, [1, 2, 1, 4]));
    // b + d bid 6 and took 13: 60 points plus 7 overtricks, which are 7 bags.
    expect(teamOf(s, d)?.score).toBe(67);
    expect(teamOf(s, d)?.tracks.bags).toBe(7);
    // a + c bid 2 and took nothing: set, minus 20.
    expect(teamOf(s, a)?.score).toBe(-20);
  });

  it('takes 100 points off at 10 bags, keeping the extra bags', () => {
    const { state, d } = deal(ONE_SUIT_EACH);
    const s = finishRound(bidAll(state, [1, 1, 1, 2]));
    // b + d bid 3 and took 13: 30 + 10 overtricks; 10 bags → minus 100, back to 0 bags.
    expect(teamOf(s, d)?.score).toBe(30 + 10 - 100);
    expect(teamOf(s, d)?.tracks.bags).toBe(0);
  });

  it('adds 100 for a made nil and takes 100 off for a failed one', () => {
    // a bids nil and takes nothing (made); d bids nil but takes every trick (failed).
    const { state, a, d } = deal(ONE_SUIT_EACH);
    const s = finishRound(bidAll(state, ['nil', 2, 1, 'nil']));
    // a + c: bid 1 (nil counts as 0), took 0 → minus 10; nil made → plus 100.
    expect(teamOf(s, a)?.score).toBe(-10 + 100);
    // b + d: bid 2, took 13 → 20 + 11 bags; 11 bags → minus 100, 1 bag left; nil failed → minus 100.
    expect(teamOf(s, d)?.score).toBe(20 + 11 - 100 - 100);
    expect(teamOf(s, d)?.tracks.bags).toBe(1);
  });

  it('doubles the stakes for blind nil', () => {
    const { state, a, d } = deal(ONE_SUIT_EACH, { blindNil: true });
    const s = finishRound(bidAll(state, ['blindNil', 2, 1, 'blindNil']));
    expect(teamOf(s, a)?.score).toBe(-10 + 200);
    expect(teamOf(s, d)?.score).toBe(20 + 11 - 100 - 200);
  });
});

describe('spades: blind nil', () => {
  it('is offered only with the option on, and only before looking', () => {
    const offered = (options: object, lookFirst: boolean) => {
      const { state, a } = deal(ONE_SUIT_EACH, options);
      const s = lookFirst ? applyMove(state, look(a)) : state;
      return getLegalMoves(s, a).some((m) => m.type === 'bid' && m.value === 'blindNil');
    };
    expect(offered({}, false)).toBe(false);
    expect(offered({ blindNil: true }, false)).toBe(true);
    expect(offered({ blindNil: true }, true)).toBe(false);
  });

  it("keeps the bidder's own hand face down until they look", () => {
    const { state, a } = deal(ONE_SUIT_EACH, { blindNil: true });
    expect(viewFor(state, a).zones[`hand@${a}`]).toEqual({ kind: 'count', count: 13, top: null });
    expect(viewFor(applyMove(state, look(a)), a).zones[`hand@${a}`]?.kind).toBe('cards');
  });
});

describe('spades: end of the game', () => {
  // The blind nil round above leaves b + d on -269.
  const blindRound = (options: object) => {
    const { state, a } = deal(ONE_SUIT_EACH, { blindNil: true, ...options });
    return { s: finishRound(bidAll(state, ['blindNil', 2, 1, 'blindNil'])), a };
  };

  it('ends when a team falls to -200 (the mercy rule, on by default)', () => {
    const { s, a } = blindRound({});
    expect(s.status).toBe('over');
    expect(s.winners).toEqual([...(teamOf(s, a)?.players ?? [])].sort());
  });

  it('carries on below -200 when the mercy rule is off', () => {
    const { s } = blindRound({ mercyRule: false });
    expect(s.status).toBe('inProgress');
    expect(s.round).toBe(2);
  });

  it('ends when a team reaches the target score', () => {
    // Seat 3 always holds every spade and wins every trick. Seats 1 and 3 bid
    // 6 + 7 = 13 each round: 130 points a round, so a target of 300 is reached in round 3.
    const hands: Hands = [suit('C'), suit('D'), suit('H'), suit('S')];
    const bySeat = [1, 6, 1, 7];
    let s = createGame(spades, { targetScore: 300 }, 4, 'target');
    while (s.status === 'inProgress') {
      if (s.round > 5) throw new Error('the game should have ended');
      s = withZones(s, Object.fromEntries(hands.map((cards, seat) => [`hand@${seat}`, cards])));
      const first = (s.dealer + 1) % 4;
      const bids = [0, 1, 2, 3].map((i) => bySeat[(first + i) % 4] ?? 1) as Bids;
      s = finishRound(bidAll(s, bids));
    }
    expect(s.round).toBe(3);
    expect(s.teams[1]?.score).toBe(390);
    expect(s.teams[0]?.score).toBe(-60);
    expect(s.winners).toEqual([1, 3]);
  });
});
