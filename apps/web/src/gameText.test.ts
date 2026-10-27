import type { GameSummary, PastGame } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import {
  dateGroup,
  minutesText,
  nameList,
  outcomeText,
  pastName,
  pastStandings,
  playersText,
  statsText,
} from './gameText';

const game = (
  players: number[],
  teams: number[][] | null,
  partnersWith: number[],
): GameSummary => ({
  slug: 'x',
  name: 'X',
  players,
  teams,
  partnersWith,
  options: {},
  minutes: null,
  cards: ['AS', 'KS', 'QS'],
  accent: 0,
});

describe('minutesText', () => {
  it('says how long a game takes, if the game says', () => {
    expect(minutesText({ minutes: [30, 60] })).toBe('30–60 min');
    expect(minutesText({ minutes: [20, 20] })).toBe('About 20 min');
    expect(minutesText({ minutes: null })).toBeNull();
  });
});

describe('playersText', () => {
  it('says how many play, and in what teams', () => {
    expect(playersText(game([2, 3, 4, 5, 6], null, []))).toBe('2–6 players');
    expect(
      playersText(
        game(
          [4],
          [
            [0, 2],
            [1, 3],
          ],
          [4],
        ),
      ),
    ).toBe('4 players, 2 teams');
    expect(playersText(game([2, 3, 4], null, [4]))).toBe('2–4 players, partners with 4');
  });
});

const spadesGame: PastGame = {
  code: 'C',
  game: { slug: 'spades', name: 'Spades' },
  status: 'finished',
  endedAt: '2026-10-10T12:00:00.000Z',
  seats: [
    { seat: 0, displayName: 'Me', bot: false },
    { seat: 1, displayName: 'Ann', bot: false },
    { seat: 2, displayName: 'Bot 3', bot: true },
  ],
  you: 0,
  seatTeams: [0, 1, 0, 1],
  winners: [1, 3],
  teams: [
    { team: 0, players: [0, 2], score: 310 },
    { team: 1, players: [1, 3], score: 520 },
  ],
  lowestWins: false,
};

describe('past games', () => {
  it('says how the game went for you', () => {
    expect(outcomeText(spadesGame)).toBe('You lost');
    expect(outcomeText({ ...spadesGame, winners: [0, 2] })).toBe('You won');
    expect(outcomeText({ ...spadesGame, winners: [0, 1] })).toBe('You shared the win');
    expect(outcomeText({ ...spadesGame, status: 'abandoned', winners: [] })).toBe('Ended early');
    const solo = { ...spadesGame, teams: [{ team: 0, players: [0], score: 3 }], winners: [0] };
    expect(outcomeText(solo)).toBe('You won');
  });

  it('puts the teams in finishing order, naming seats no one holds now', () => {
    expect(pastStandings(spadesGame).map((t) => [t.team, t.won])).toEqual([
      [1, true],
      [0, false],
    ]);
    expect(pastName(spadesGame, 0)).toBe('You');
    expect(pastName(spadesGame, 2)).toBe('Bot 3');
    expect(pastName(spadesGame, 3)).toBe('Seat 4');
    expect(pastStandings({ ...spadesGame, teams: null })).toEqual([]);
  });

  it('puts the teams that lost lowest first where the lowest score wins', () => {
    const hearts = {
      ...spadesGame,
      winners: [2],
      lowestWins: true,
      teams: [0, 1, 2, 3].map((seat) => ({
        team: seat,
        players: [seat],
        score: [80, 101, 40, 60][seat] ?? 0,
      })),
    };
    expect(pastStandings(hearts).map((t) => t.score)).toEqual([40, 60, 80, 101]);
    expect(pastStandings({ ...hearts, lowestWins: false }).map((t) => t.score)).toEqual([
      40, 101, 80, 60,
    ]);
  });

  it('lists names', () => {
    expect(nameList(['Ana'])).toBe('Ana');
    expect(nameList(['Ana', 'Raj', 'Sam'])).toBe('Ana, Raj and Sam');
  });

  it('groups games by when they ended: today, this week, this month, older', () => {
    // Thursday 15 October 2026, in local time.
    const now = new Date(2026, 9, 15, 18, 30);
    const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
    expect(dateGroup(at(15, 0), now)).toBe('Today');
    expect(dateGroup(at(14, 23), now)).toBe('This week');
    expect(dateGroup(at(12, 0), now)).toBe('This week');
    expect(dateGroup(at(11, 23), now)).toBe('Earlier this month');
    expect(dateGroup(at(1, 0), now)).toBe('Earlier this month');
    expect(dateGroup(new Date(2026, 8, 30, 23).toISOString(), now)).toBe('Older');
    expect(dateGroup(null, now)).toBe('Older');
    // A week that began last month: those days are this week.
    const friday = new Date(2026, 9, 2, 9);
    expect(dateGroup(new Date(2026, 8, 29, 12).toISOString(), friday)).toBe('This week');
    expect(dateGroup(new Date(2026, 8, 27, 12).toISOString(), friday)).toBe('Older');
  });

  it('sums up games played and won', () => {
    expect(statsText({ game: { slug: 'spades', name: 'Spades' }, played: 3, won: 1 })).toBe(
      'Spades: 3 played, 1 won',
    );
  });
});
