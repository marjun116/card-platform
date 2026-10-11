import type { GameSummary, PastGame } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import { finalScoresText, outcomeText, playersText, statsText } from './gameText';

const game = (
  players: number[],
  teams: number[][] | null,
  partnersWith: number[],
): GameSummary => ({ slug: 'x', name: 'X', players, teams, partnersWith, options: {} });

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
  winners: [1, 3],
  teams: [
    { players: [0, 2], score: 310 },
    { players: [1, 3], score: 520 },
  ],
};

describe('past games', () => {
  it('says how the game went for you', () => {
    expect(outcomeText(spadesGame)).toBe('You lost');
    expect(outcomeText({ ...spadesGame, winners: [0, 2] })).toBe('You won');
    expect(outcomeText({ ...spadesGame, winners: [0, 1] })).toBe('You shared the win');
    expect(outcomeText({ ...spadesGame, status: 'abandoned', winners: [] })).toBe('Ended early');
    const solo = { ...spadesGame, teams: [{ players: [0], score: 3 }], winners: [0] };
    expect(outcomeText(solo)).toBe('You won');
  });

  it('lists the final scores, winners first, naming seats no one holds now', () => {
    expect(finalScoresText(spadesGame)).toBe('Ann & Seat 4 520 · You & Bot 3 310');
    expect(finalScoresText({ ...spadesGame, teams: null })).toBe('');
  });

  it('sums up games played and won', () => {
    expect(statsText({ game: { slug: 'spades', name: 'Spades' }, played: 3, won: 1 })).toBe(
      'Spades: 3 played, 1 won',
    );
  });
});
