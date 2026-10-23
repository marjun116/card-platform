import type { RoundResult } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { finishingOrder, gameStats, ordinal } from './results';

const team = (id: number, score: number, players = [id]) => ({
  id,
  players,
  score,
  tricks: 0,
  tracks: {},
  held: {},
});

/** A round of two teams of two (seats 0 & 2 against 1 & 3). */
function round(
  n: number,
  points: [number, number],
  made: [boolean | null, boolean | null],
  players: { bid: number | null; tricks: number }[],
): RoundResult {
  return {
    round: n,
    dealer: 0,
    teams: [0, 1].map((id) => ({
      id,
      points: points[id] ?? 0,
      score: 0,
      tricks: 0,
      tracks: {},
      held: {},
      parts: [],
      made: made[id] ?? null,
    })),
    players: players.map((p, id) => ({ id, ...p, tracks: {}, eliminated: false })),
  };
}

const seats = [0, 1, 2, 3].map((id) => ({ id, team: id % 2 }));

describe('finishingOrder', () => {
  it('puts the winners first, then the highest scores, sharing places when level', () => {
    const order = finishingOrder(
      [team(0, 80), team(1, 120), team(2, 80), team(3, 100)],
      [1],
      'highestScore',
    );
    expect(order.map((p) => [p.team.id, p.place])).toEqual([
      [1, 1],
      [3, 2],
      [0, 3],
      [2, 3],
    ]);
  });

  it('puts the lowest scores first where the lowest wins', () => {
    const order = finishingOrder([team(0, 90), team(1, 30), team(2, 60)], [1], 'lowestScore');
    expect(order.map((p) => p.team.id)).toEqual([1, 2, 0]);
  });

  it('puts the winners first even when they are not ahead on score', () => {
    // Last player standing: the winner may have fewer points.
    const order = finishingOrder([team(0, 50), team(1, 10)], [1], 'lastActivePlayer');
    expect(order.map((p) => [p.team.id, p.place])).toEqual([
      [1, 1],
      [0, 2],
    ]);
  });
});

describe('ordinal', () => {
  it('says 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
});

describe('gameStats', () => {
  it('adds up tricks and bids made over the game, and finds the biggest round', () => {
    const history = [
      round(
        1,
        [60, -40],
        [true, false],
        [
          { bid: 3, tricks: 4 },
          { bid: 4, tricks: 2 },
          { bid: 3, tricks: 3 },
          { bid: 1, tricks: 4 },
        ],
      ),
      round(
        2,
        [-50, 120],
        [false, true],
        [
          { bid: 2, tricks: 1 },
          { bid: 5, tricks: 6 },
          { bid: 3, tricks: 2 },
          { bid: 2, tricks: 4 },
        ],
      ),
    ];
    const stats = gameStats(history, seats);
    expect(stats.players.map((p) => [p.tricks, p.bids.made, p.bids.of])).toEqual([
      [5, 1, 2],
      [8, 1, 2],
      [5, 1, 2],
      [8, 1, 2],
    ]);
    expect(stats.showTricks).toBe(true);
    expect(stats.showBids).toBe(true);
    expect(stats.biggest).toEqual({ round: 2, team: 1, points: 120 });
  });

  it("counts a bid only where the player's team had a contract (bridge's defenders don't)", () => {
    const history = [
      round(
        1,
        [0, 140],
        [null, true],
        [
          { bid: 1, tricks: 2 },
          { bid: 4, tricks: 5 },
          { bid: 2, tricks: 2 },
          { bid: 3, tricks: 4 },
        ],
      ),
    ];
    const stats = gameStats(history, seats);
    expect(stats.players.map((p) => p.bids)).toEqual([
      { made: 0, of: 0 },
      { made: 1, of: 1 },
      { made: 0, of: 0 },
      { made: 1, of: 1 },
    ]);
  });

  it('shows no tricks or bids in games without them, and no biggest round without points', () => {
    const quiet = round(
      1,
      [0, 0],
      [null, null],
      seats.map(() => ({ bid: null, tricks: 0 })),
    );
    const stats = gameStats([quiet], seats);
    expect(stats.showTricks).toBe(false);
    expect(stats.showBids).toBe(false);
    expect(stats.biggest).toBeNull();
  });

  it('keeps the earliest round when two are level', () => {
    const tie = (n: number) => round(n, [50, 50], [null, null], []);
    expect(gameStats([tie(1), tie(2)], seats).biggest).toEqual({ round: 1, team: 0, points: 50 });
  });
});
