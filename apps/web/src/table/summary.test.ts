import type { MomentEvent, RoundResult } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { highlights, leaders, partsText, progress, teamBid } from './summary';

const NAMES = ['Raj', 'Bot 1', 'Ana', 'Bot 3'];
const names = (seat: number) => NAMES[seat] ?? `Seat ${seat}`;
const TEAMS = [
  { id: 0, players: [0, 2] },
  { id: 1, players: [1, 3] },
];

function round(over: Partial<RoundResult> = {}): RoundResult {
  const team = (id: number, points: number, tricks: number) => ({
    id,
    points,
    score: points,
    tricks,
    tracks: {},
    held: {},
    parts: [],
    made: null,
  });
  const player = (id: number, bid: RoundResult['players'][number]['bid'], tricks: number) => ({
    id,
    bid,
    tricks,
    tracks: {},
    eliminated: false,
  });
  return {
    round: 2,
    dealer: 0,
    teams: [team(0, 61, 7), team(1, 40, 6)],
    players: [player(0, 4, 6), player(1, 2, 4), player(2, 'nil', 1), player(3, 2, 2)],
    ...over,
  };
}

const moment = (over: Partial<MomentEvent>): MomentEvent => ({
  round: 2,
  at: 0,
  label: 'Nil broken',
  player: null,
  team: null,
  ...over,
});

describe('partsText', () => {
  it('lists where the points came from, signed', () => {
    expect(
      partsText([
        { label: 'Tricks', points: 60 },
        { label: 'Bags', points: 2 },
        { label: 'Nil', points: -100 },
      ]),
    ).toBe('Tricks +60 · Bags +2 · Nil -100');
  });

  it('calls unlabelled points "Other", and says nothing when none are labelled', () => {
    expect(
      partsText([
        { label: 'Gin', points: 25 },
        { label: null, points: 5 },
      ]),
    ).toBe('Gin +25 · Other +5');
    expect(partsText([{ label: null, points: 12 }])).toBeNull();
    expect(partsText([])).toBeNull();
  });
});

describe('teamBid', () => {
  it("adds partners' number bids, with nil as 0", () => {
    expect(teamBid(round(), [0, 2])).toBe(4);
    expect(teamBid(round(), [1, 3])).toBe(4);
  });

  it('is null when nobody bid a number, or a bid has words of its own', () => {
    const allNil = round();
    allNil.players = allNil.players.map((p) => ({ ...p, bid: p.id % 2 === 0 ? 'nil' : null }));
    expect(teamBid(allNil, [0, 2])).toBeNull();
    expect(teamBid(round(), [0, 2], { '4': '1♣' })).toBeNull();
  });
});

describe('leaders', () => {
  const teams = [
    { id: 0, score: 40 },
    { id: 1, score: 90 },
    { id: 2, score: 40 },
  ];

  it('picks the highest score, or the lowest where the lowest wins', () => {
    expect(leaders(teams, 'highestScore')).toEqual([1]);
    expect(leaders(teams, 'lowestScore')).toEqual([0, 2]);
  });

  it('has none while everyone is level, or in games not won on score', () => {
    expect(
      leaders(
        teams.map((t) => ({ ...t, score: 0 })),
        'highestScore',
      ),
    ).toEqual([]);
    expect(leaders(teams, 'lastActivePlayer')).toEqual([]);
  });
});

describe('progress', () => {
  it('runs from 0 to 1, whatever the score', () => {
    expect(progress(250, 500)).toBe(0.5);
    expect(progress(-120, 500)).toBe(0);
    expect(progress(530, 500)).toBe(1);
  });
});

describe('highlights', () => {
  it("puts the round's big moments first, at most two", () => {
    const moments = [
      moment({ player: 2 }),
      moment({ label: 'Set!', team: 1 }),
      moment({ label: 'Old news', round: 1 }),
    ];
    expect(highlights(round(), moments, TEAMS, names)).toEqual([
      'Ana: Nil broken',
      'Team 2 (Bot 1 & Bot 3): Set!',
    ]);
  });

  it('then whoever took the most tricks, then the top-scoring team', () => {
    expect(highlights(round(), [], TEAMS, names)).toEqual([
      'Raj took 6 tricks',
      'Team 1 (Raj & Ana) scored 61',
    ]);
  });

  it('leaves out ties and rounds nobody scored in', () => {
    const level = round();
    level.players = level.players.map((p) => ({ ...p, tricks: 3 }));
    level.teams = level.teams.map((t) => ({ ...t, points: 0 }));
    expect(highlights(level, [], TEAMS, names)).toEqual([]);
  });
});
