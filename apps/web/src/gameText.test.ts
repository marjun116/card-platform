import type { GameSummary } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import { playersText } from './gameText';

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
