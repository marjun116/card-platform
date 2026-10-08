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
import type { OptionValue } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { type BuiltInGameName, builtInGames } from './index';

/** A player that plays like a person would, at least a little. */
const SENSIBLE: Record<BuiltInGameName, Strategy> = {
  // Bid low, so teams make their bids, games run to 500 and bags pile up.
  spades: preferring((m) => m.type === 'bid' && typeof m.value === 'number' && m.value <= 3),
  // Duck tricks with low cards, so points spread out and games last.
  hearts: preferring((m) => m.type === 'playToTrick' && /^[2-7][CDHS]/.test(m.card)),
};

/**
 * House rules that change how a game plays, simulated on top of the random
 * games. Each set is played in a batch of its own.
 */
const VARIANTS: Partial<Record<BuiltInGameName, Record<string, OptionValue>[]>> = {
  spades: [{ nil: false, blindNil: true, targetScore: 300 }],
  hearts: [
    { moon: 'shooterChooses', jackOfDiamonds: true, passing: 'rotateNoHold', shareTies: true },
    {
      moon: 'shooterMinus26',
      pointsOnFirstTrick: true,
      queenBreaksHearts: true,
      passing: 'left',
      firstLead: 'leftOfDealer',
      targetScore: 50,
    },
    { leadHeartsAnytime: true, passing: 'none', targetScore: 150 },
  ],
};
const VARIANT_GAMES = 200;

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

  const variants = VARIANTS[name as BuiltInGameName] ?? [];
  it.each(variants.map((options) => [JSON.stringify(options), options] as const))(
    `plays ${VARIANT_GAMES} random games with house rules %s`,
    { timeout: 300_000 },
    (label, options) => {
      const report = simulateMany(file, {
        games: VARIANT_GAMES,
        seedPrefix: `${name}-${label}`,
        strategy: randomStrategy,
        options,
      });
      expect(report.games).toBe(VARIANT_GAMES);
    },
  );
});
