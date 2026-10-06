/**
 * The random-play simulation every built-in game must pass (CLAUDE.md):
 * 1,000 seeded games of random legal moves with no crashes and no illegal
 * states, checked after every move by the engine's harness.
 *
 * Purely random play is shallow in some games (random spades bids sink both
 * teams within a couple of rounds), so each game also plays a smaller batch
 * with a "sensible" player that reaches the parts random play never does.
 */
import {
  type Strategy,
  preferring,
  randomStrategy,
  simulateMany,
} from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { type BuiltInGameName, builtInGames } from './index';

/** A player that plays like a person would, at least a little. */
const SENSIBLE: Record<BuiltInGameName, Strategy> = {
  // Bid low, so teams make their bids, games run to 500 and bags pile up.
  spades: preferring((m) => m.type === 'bid' && typeof m.value === 'number' && m.value <= 3),
};

const RANDOM_GAMES = 1_000;
const SENSIBLE_GAMES = 50;

describe.each(Object.entries(builtInGames))('%s simulation', (name, file) => {
  it(`plays ${RANDOM_GAMES} random games without a problem`, { timeout: 300_000 }, () => {
    const report = simulateMany(file, {
      games: RANDOM_GAMES,
      seedPrefix: `${name}-random`,
      strategy: randomStrategy,
    });
    expect(report.games).toBe(RANDOM_GAMES);
  });

  it(`plays ${SENSIBLE_GAMES} sensible games without a problem`, { timeout: 300_000 }, () => {
    const report = simulateMany(file, {
      games: SENSIBLE_GAMES,
      seedPrefix: `${name}-sensible`,
      strategy: SENSIBLE[name as BuiltInGameName],
    });
    // These games should get past the first couple of rounds.
    expect(report.averageRounds).toBeGreaterThan(5);
  });
});
