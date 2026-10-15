/**
 * The server holds each new deal until everyone has closed the round's scores
 * (ApplyOptions.holdNextRound). Every built-in game must play out exactly the
 * same that way: simulateMany replays each game without holding and compares.
 */
import { randomStrategy, simulateMany } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { type BuiltInGameName, builtInGames } from './index';
import { BASE_OPTIONS, RANDOM } from './simulation';

describe('holding the next deal', () => {
  for (const name of Object.keys(builtInGames) as BuiltInGameName[]) {
    it(`plays ${name} exactly as dealing straight away does`, { timeout: 120_000 }, () => {
      const report = simulateMany(builtInGames[name], {
        games: 10,
        seedPrefix: `hold-${name}`,
        replayEvery: 1,
        holdNextRound: true,
        strategy: RANDOM[name] ?? randomStrategy,
        options: BASE_OPTIONS[name] ?? {},
      });
      // Several rounds a game on average, so plenty of deals were held.
      expect(report.averageRounds).toBeGreaterThan(1.5);
    });
  }
});
