/** Scenario tests for the spec's spades example: bidding, leading, trumps and scoring. */
import { describe, expect, it } from 'vitest';
import { spades } from './__fixtures__/games';
import { id, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import type { Move } from './game/move';
import { draft, type GameState } from './game/state';
import { scoreRound } from './scoring';

const bid = (player: number, value: number | string): Move => ({ player, type: 'bid', value });
const trick = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});
const look = (player: number): Move => ({ player, type: 'lookAtHand' });

/** Seats in bidding order: left of the dealer first. */
const seatsFrom = (state: GameState): number[] => {
  const first = (state.dealer + 1) % 4;
  return [first, (first + 1) % 4, (first + 2) % 4, (first + 3) % 4];
};

/** Everyone bids in turn from the first bidder, looking first unless bidding blind. */
function afterBidding(state: GameState, bids: (number | string)[]): GameState {
  const order = seatsFrom(state);
  return play(
    state,
    ...order.flatMap((seat, i) => {
      const value = bids[i] ?? 1;
      return value === 'blindNil' ? [bid(seat, value)] : [look(seat), bid(seat, value)];
    }),
  );
}

// Hands by bidding position: everyone is long in one suit.
const HANDS = [
  ['2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH', 'AS'],
  ['2C', '3C', '4C', '5C', '6C', '7C', '8C', '9C', '10C', 'JC', 'QC', 'KC', 'AH'],
  ['2D', '3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D', 'JD', 'QD', 'KD', 'AC'],
  ['2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S', 'JS', 'QS', 'KS', 'AD'],
];

function dealt(seed = 'spades', options = {}) {
  const base = createGame(spades, options, 4, seed);
  const order = seatsFrom(base);
  const zones = Object.fromEntries(order.map((seat, i) => [`hand@${seat}`, HANDS[i] ?? []]));
  const [a = 0, b = 1, c = 2, d = 3] = order;
  return { state: withZones(base, zones), order, a, b, c, d };
}

describe('spades bidding', () => {
  it('goes once round the table starting left of the dealer', () => {
    const { state, order, a } = dealt();
    expect(state.cursor.current).toBe(a);
    // 1–13 plus nil (blind nil is off by default)
    expect(getLegalMoves(state, a).filter((m) => m.type === 'bid')).toHaveLength(14);
    const bids = [3, 'nil', 4, 2];
    const next = afterBidding(state, bids);
    expect(next.players.map((p) => p.bid)).toEqual(
      [0, 1, 2, 3].map((seat) => bids[order.indexOf(seat)]),
    );
    expect(next.file.phases[next.cursor.phase]?.name).toBe('play');
  });

  it('only offers nil when the option is on', () => {
    const { state, a } = dealt('x', { nil: false });
    const nil = getLegalMoves(state, a).some((m) => m.type === 'bid' && m.value === 'nil');
    expect(nil).toBe(false);
  });
});

describe('blind nil', () => {
  it('keeps your own hand face down until you look', () => {
    const { state, a } = dealt('blind', { blindNil: true });
    expect(viewFor(state, a).zones[`hand@${a}`]).toEqual({ kind: 'count', count: 13, top: null });
    const looked = applyMove(state, look(a));
    expect(viewFor(looked, a).zones[`hand@${a}`]?.kind).toBe('cards');
    // Looking doesn't use up the turn.
    expect(looked.cursor.current).toBe(a);
  });

  it('can only be bid before looking', () => {
    const { state, a } = dealt('blind', { blindNil: true });
    const isBlind = (m: Move) => m.type === 'bid' && m.value === 'blindNil';
    expect(getLegalMoves(state, a).some(isBlind)).toBe(true);
    expect(getLegalMoves(applyMove(state, look(a)), a).some(isBlind)).toBe(false);
  });

  it('counts a normal bid as not looking, but any other move as looking', () => {
    const { state, a } = dealt('blind', { blindNil: true });
    const next = applyMove(state, bid(a, 'blindNil'));
    expect(next.players[a]?.hasLookedAtHand).toBe(false);
  });

  it('lets a player look while waiting for their turn', () => {
    const { state, c } = dealt('blind', { blindNil: true });
    expect(getLegalMoves(state, c)).toEqual([{ player: c, type: 'lookAtHand' }]);
  });
});

describe('spades play', () => {
  it("can't lead spades before they're broken", () => {
    const { state, a } = dealt();
    const playing = afterBidding(state, [3, 3, 3, 3]);
    // The first leader holds 12 hearts and the ace of spades.
    const leads = getLegalMoves(playing, a);
    expect(leads).toHaveLength(12);
    expect(leads).not.toContainEqual(trick(a, 'AS'));
  });

  it('may lead spades when holding nothing else', () => {
    const { state, a, d } = dealt();
    const playing = afterBidding(state, [3, 3, 3, 3]);
    const onlySpades = withZones(playing, { [`hand@${a}`]: ['AS'] }, `hand@${d}`);
    expect(getLegalMoves(onlySpades, a)).toEqual([trick(a, 'AS')]);
  });

  it('trumps a trick with any spade and breaks spades', () => {
    const { state, a, b, c, d } = dealt();
    let s = afterBidding(state, [3, 3, 3, 3]);
    // c and d have no hearts, so they may play anything; d trumps with a low spade.
    s = play(s, trick(a, '2H'), trick(b, 'AH'), trick(c, '2D'), trick(d, '2S'));
    expect(s.lastTrick?.winner).toBe(d);
    expect(s.vars.spadesBroken).toBe(true);
    expect(s.cursor.current).toBe(d);
    expect(getLegalMoves(s, d)).toContainEqual(trick(d, '3S'));
    expect(s.zones[`won@t${s.players[d]?.team}`]).toHaveLength(4);
  });

  it('gives the trick to the highest led card when no spade is played', () => {
    const { state, a, b, c, d } = dealt();
    let s = afterBidding(state, [3, 3, 3, 3]);
    s = play(s, trick(a, 'KH'), trick(b, 'AH'), trick(c, '2D'), trick(d, 'AD'));
    expect(s.lastTrick?.winner).toBe(b);
    expect(s.vars.spadesBroken).toBeUndefined();
  });

  it('plays a full round, scores it and deals the next', () => {
    const { state } = dealt();
    let s = afterBidding(state, [3, 3, 3, 3]);
    while (s.round === 1) {
      const move = getLegalMoves(s, s.cursor.current).find((m) => m.type !== 'lookAtHand');
      if (!move) throw new Error('stuck');
      s = applyMove(s, move);
    }
    expect(s.round).toBe(2);
    expect(s.dealer).toBe((state.dealer + 1) % 4);
    expect(s.teams.reduce((n, t) => n + t.tricks, 0)).toBe(0); // reset for the new round
    expect(s.teams.some((t) => t.score !== 0)).toBe(true);
    for (let seat = 0; seat < 4; seat++) expect(s.zones[`hand@${seat}`]).toHaveLength(13);
  });
});

describe('spades scoring', () => {
  /** Scores a round where each bidding position bid and took the given numbers. */
  function scored(bids: (number | string)[], tricks: number[], bags = 0, options = {}) {
    const { state, order, a, b } = dealt('score', options);
    const s = draft(afterBidding(state, bids));
    order.forEach((seat, i) => {
      const player = s.players[seat];
      if (player) player.tricks = tricks[i] ?? 0;
    });
    for (const team of s.teams) {
      team.tricks = team.players.reduce((n, p) => n + (s.players[p]?.tricks ?? 0), 0);
      team.tracks.bags = bags;
    }
    scoreRound(s);
    const teamOf = (seat: number) => s.teams[s.players[seat]?.team ?? 0];
    return { teamA: teamOf(a), teamB: teamOf(b) };
  }

  it('scores made bids with overtricks, and set bids', () => {
    // Team A (positions 1 and 3) bid 4 + 2, took 5 + 1. Team B bid 3 + 3, took 2 + 5.
    const { teamA, teamB } = scored([4, 3, 2, 3], [5, 2, 1, 5]);
    expect(teamA?.score).toBe(60);
    expect(teamB?.score).toBe(60 + 1);
    expect(teamB?.tracks.bags).toBe(1);
  });

  it('takes 10 points per trick bid when the team is set', () => {
    const { teamA } = scored([5, 1, 4, 1], [3, 2, 3, 5]);
    expect(teamA?.score).toBe(-90);
  });

  it('counts bags and takes 100 off at ten', () => {
    // Team A bid 2, took 10: 20 + 8 overtricks; bags 8 + 8 = 16 → -100 and 6 bags left.
    const { teamA } = scored([1, 1, 1, 1], [5, 1, 5, 2], 8);
    expect(teamA?.score).toBe(20 + 8 - 100);
    expect(teamA?.tracks.bags).toBe(6);
  });

  it('adds 100 for a made nil', () => {
    // Team B: nil took 0 (+100); partner bid 2, took 7 (20 + 5).
    const { teamB } = scored([3, 'nil', 3, 2], [3, 0, 3, 7]);
    expect(teamB?.score).toBe(100 + 25);
  });

  it('takes 100 off for a failed nil', () => {
    const { teamB } = scored([3, 'nil', 3, 2], [3, 1, 3, 6]);
    expect(teamB?.score).toBe(-100 + 25);
  });

  it('doubles the stakes for blind nil', () => {
    const blind = { blindNil: true };
    expect(scored([3, 'blindNil', 3, 2], [3, 0, 3, 7], 0, blind).teamB?.score).toBe(200 + 25);
    expect(scored([3, 'blindNil', 3, 2], [3, 1, 3, 6], 0, blind).teamB?.score).toBe(-200 + 25);
  });
});

describe('spades game end', () => {
  /** Scores a round where every team bid 2 and took nothing (-20 each), from these scores. */
  function endOfRound(scores: [number, number], options = {}) {
    const { state } = dealt('end', options);
    const s = draft(afterBidding(state, [1, 1, 1, 1]));
    s.teams.forEach((team, i) => (team.score = scores[i] ?? 0));
    scoreRound(s);
    return { s };
  }

  it('ends when a team reaches the target score', () => {
    const { s } = endOfRound([520, 100]);
    expect(s.status).toBe('over');
    expect(s.winners).toEqual(s.teams[0]?.players);
  });

  it('ends when a team falls to -200 (mercy rule, on by default)', () => {
    const { s } = endOfRound([-190, 100]);
    expect(s.teams[0]?.score).toBe(-210);
    expect(s.status).toBe('over');
    expect(s.winners).toEqual(s.teams[1]?.players);
  });

  it('keeps going below -200 when the mercy rule is off', () => {
    const { s } = endOfRound([-190, 100], { mercyRule: false });
    expect(s.teams[0]?.score).toBe(-210);
    expect(s.status).toBe('inProgress');
  });

  it('keeps going when neither limit is reached', () => {
    expect(endOfRound([-150, 100]).s.status).toBe('inProgress');
  });
});
