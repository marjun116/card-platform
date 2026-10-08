/**
 * Scenario tests for oh-hell.json: the rules a real table would check.
 * Three-player tests name seats from the left of the dealer: a, b, then the dealer c.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
} from '@card-table/engine';
import { draft, id, play, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const ohHell = builtInGames['oh-hell'];
type Options = Record<string, OptionValue>;

const bids = (state: GameState, seat: number) =>
  getLegalMoves(state, seat).flatMap((m) => (m.type === 'bid' ? [m.value] : []));
const bid = (player: number, value: number): Move => ({ player, type: 'bid', value });
const card = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});
const score = (state: GameState, seat: number) => state.teams[seat]?.score;

/** Plays the game with everyone's first legal move, recording the hand size of each hand. */
function handSizes(players: number, options: Options = {}): { sizes: number[]; state: GameState } {
  let state = createGame(ohHell, options, players, 'sizes');
  const sizes: number[] = [];
  while (state.status === 'inProgress') {
    if (sizes.length < state.round) sizes.push(state.zones[`hand@${state.dealer}`]?.length ?? 0);
    const seat = state.cursor.current;
    const moves = getLegalMoves(state, seat).filter((m) => m.type !== 'lookAtHand');
    state = applyMove(state, moves[0] ?? { player: seat, type: 'lookAtHand' });
  }
  return { sizes, state };
}

describe('Oh Hell: the hands', () => {
  it('goes up from 1 to 10 and back down for four players', () => {
    const { sizes, state } = handSizes(4);
    expect(sizes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(state.status).toBe('over');
  });

  it('tops out lower with more players, leaving a card to turn up', () => {
    // 51 / 7 = 7 cards at most.
    expect(handSizes(7).sizes).toEqual([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('follows the other sequences', () => {
    expect(handSizes(5, { sequence: 'down', maxCards: 7 }).sizes).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(handSizes(5, { sequence: 'up', maxCards: 7 }).sizes).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(handSizes(5, { sequence: 'downUp', maxCards: 7 }).sizes).toEqual([
      7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('turns up a trump card, or plays without trump when the deck runs out', () => {
    const first = createGame(ohHell, {}, 4, 'trump');
    const up = first.zones.trumpCard?.[0];
    expect(first.vars.trump).toBe(up && 'suit' in up ? up.suit : null);
    // Four players, as many as the deck allows: 13 each, nothing left over.
    const s = draft(createGame(ohHell, { sequence: 'down', maxCards: 'max' }, 4, 'trump'));
    expect(s.zones['hand@0']).toHaveLength(13);
    expect(s.zones.trumpCard).toHaveLength(0);
    expect(s.vars.trump ?? null).toBeNull();
  });

  it('plays the biggest hand without trump with that house rule', () => {
    const state = createGame(ohHell, { sequence: 'down', maxCards: 7, topNoTrump: true }, 4, 'top');
    expect(state.zones.trumpCard).toHaveLength(1);
    expect(state.vars.trump).toBeNull();
  });
});

/** Three players, one card each (the first hand), trump hearts: a holds A♠, b 2♠, the dealer 3♠. */
function firstHand(options: Options = {}) {
  const base = createGame(ohHell, options, 3, 'hand');
  const c = base.dealer;
  const [a, b] = [(c + 1) % 3, (c + 2) % 3];
  const state = withZones(
    base,
    { [`hand@${a}`]: ['AS'], [`hand@${b}`]: ['2S'], [`hand@${c}`]: ['3S'] },
    'stock',
  );
  state.vars.trump = 'hearts';
  return { state, a, b, c };
}

describe('Oh Hell: bidding', () => {
  it('bids from 0 up to the number of cards held', () => {
    const { state, a } = firstHand();
    expect(bids(state, a)).toEqual([0, 1]);
  });

  it("won't let the dealer make the bids add up to the number of tricks (the hook)", () => {
    const { state, a, b, c } = firstHand();
    const s = play(state, bid(a, 1), bid(b, 0));
    expect(bids(s, c)).toEqual([1]);
    const off = firstHand({ hook: false });
    expect(bids(play(off.state, bid(off.a, 1), bid(off.b, 0)), off.c)).toEqual([0, 1]);
  });
});

describe('Oh Hell: scoring', () => {
  /** a bids 1 and wins with the A♠; b bids 0 and makes it; the dealer must bid 1 and misses. */
  const playHand = (options: Options = {}) => {
    const { state, a, b, c } = firstHand(options);
    const s = play(
      state,
      bid(a, 1),
      bid(b, 0),
      bid(c, 1),
      card(a, 'AS'),
      card(b, '2S'),
      card(c, '3S'),
    );
    return { s, a, b, c };
  };

  it('scores 10 + bid for an exact bid, and nothing otherwise', () => {
    const { s, a, b, c } = playHand();
    expect([score(s, a), score(s, b), score(s, c)]).toEqual([11, 10, 0]);
  });

  it('scores tricks taken plus 10 for exact, with that house rule', () => {
    const { s, a, b, c } = playHand({ scoring: 'perTrick' });
    expect([score(s, a), score(s, b), score(s, c)]).toEqual([11, 10, 0]);
  });

  it('takes a point off per trick missed, with that house rule', () => {
    const { s, c } = playHand({ scoring: 'penalty' });
    expect(score(s, c)).toBe(-1);
  });

  it('doubles a blind bid that is made', () => {
    const { state, a, b, c } = firstHand({ blindBids: true });
    // Hands start face down: a bids blind, the others look first.
    expect(state.players[a]?.hasLookedAtHand).toBe(false);
    const look = (p: number): Move => ({ player: p, type: 'lookAtHand' });
    const s = play(
      state,
      bid(a, 1),
      look(b),
      bid(b, 0),
      look(c),
      bid(c, 1),
      card(a, 'AS'),
      card(b, '2S'),
      card(c, '3S'),
    );
    expect(score(s, a)).toBe(22);
    expect(score(s, b)).toBe(10);
  });
});
