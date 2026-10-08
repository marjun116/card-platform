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
  // Play a card whenever possible instead of drawing.
  'crazy-eights': preferring((m) => m.type === 'play'),
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
  'crazy-eights': [
    {
      drawing: 'one',
      reshuffle: true,
      drawTwo: true,
      stackTwos: true,
      jacksSkip: true,
      acesReverse: true,
      queenOfSpades: true,
      targetScore: 200,
    },
    {
      scoring: 'penalty',
      drawing: 'upToThree',
      cards: 8,
      starterEight: 'counts',
      drawTwo: true,
      reshuffle: true,
      // Random players drawing up to 3 with reshuffles build huge hands, so keep it to one.
      targetScore: 'oneHand',
    },
    { cards: 7, targetScore: 200 },
  ],
};
const VARIANT_GAMES = 200;

const RANDOM_GAMES = 1_000;
const SENSIBLE_GAMES = 50;

/** Hands a sensible game should last on average, so it reaches its later rounds. */
const MIN_ROUNDS: Record<BuiltInGameName, number> = {
  spades: 5,
  hearts: 5,
  // The winner collects 50 per 8, so games to 100 are short.
  'crazy-eights': 2,
};

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
    expect(report.averageRounds).toBeGreaterThan(MIN_ROUNDS[name as BuiltInGameName]);
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
