/**
 * Random play of every test game to the end, using the shared harness in
 * src/testing. Built-in games get the full 1,000-game run in packages/games.
 */
import { describe, expect, it } from 'vitest';
import { allFixtures, tinyTricks } from './__fixtures__/games';
import type { GameState } from './game/state';
import {
  findHiddenCardLeak,
  preferring,
  randomStrategy,
  SimulationError,
  simulateGame,
  simulateMany,
} from './testing';

/**
 * Purely random play can go on forever in some games (rummy players who never
 * meld), so this player melds whenever it can and bids low.
 */
const sensible = preferring(
  (m) =>
    m.type === 'meld' ||
    m.type === 'layOff' ||
    (m.type === 'bid' && typeof m.value === 'number' && m.value <= 3),
);

/**
 * Mini rummy reshuffles forever by default, and a hand can reach a stalemate
 * nobody can win (every card that could be laid off is already melded). Real
 * tables can set a reshuffle limit for that; the simulation always does.
 */
const OPTIONS: Partial<Record<keyof typeof allFixtures, Record<string, number>>> = {
  miniRummy: { reshuffles: 1 },
  // Short games, so most end in the middle of a round.
  counting: { target: 5 },
};

const GAMES: Record<keyof typeof allFixtures, number> = {
  spades: 5,
  sevensUp: 30,
  tinyTricks: 30,
  miniRummy: 10,
  passing: 10,
  wildRummy: 20,
  counting: 30,
};

describe('random play', () => {
  for (const [name, file] of Object.entries(allFixtures)) {
    it(`${name} finishes cleanly`, { timeout: 60_000 }, () => {
      const report = simulateMany(file, {
        games: GAMES[name as keyof typeof allFixtures],
        seedPrefix: name,
        options: OPTIONS[name as keyof typeof allFixtures] ?? {},
        strategy: sensible,
        replayEvery: 5,
      });
      expect(report.averageMoves).toBeGreaterThan(0);
    });
  }
});

describe('the simulation harness', () => {
  it('reports the seed and move count when something goes wrong', () => {
    const failing = () =>
      simulateGame(tinyTricks, 2, 'boom', {
        check: (_state, n) => {
          if (n === 3) throw new Error('bad state');
        },
      });
    expect(failing).toThrow(SimulationError);
    expect(failing).toThrow('Error: bad state\n  (seed "boom", 2 players, after 3 moves)');
  });

  it('rejects a strategy that picks an illegal move', () => {
    const cheat = () =>
      simulateGame(tinyTricks, 2, 'cheat', {
        strategy: (moves) => ({ ...(moves[0] as object), card: 'AS.0' }) as never,
      });
    expect(cheat).toThrow("The strategy chose a move that isn't legal");
  });

  it('gives up on games that run too long', () => {
    expect(() => simulateGame(tinyTricks, 2, 'long', { maxMoves: 3 })).toThrow(
      "didn't finish within 3 moves",
    );
  });

  it('reports games that cannot start', () => {
    expect(() => simulateGame(tinyTricks, 5, 'x')).toThrow('createGame failed');
  });

  it('notices a hidden card that a player can see', () => {
    const { state } = simulateGame(tinyTricks, 2, 'leak', { strategy: randomStrategy });
    expect(findHiddenCardLeak(state)).toBeNull();
    // Pretend the game keeps a hidden card's id in public state.
    const won = Object.entries(state.zones).find(
      ([k, cards]) => k.startsWith('won') && cards.length > 0,
    );
    const leaky: GameState = { ...state, vars: { peek: won?.[1][0]?.id ?? '' } };
    expect(findHiddenCardLeak(leaky)).toMatch(/^Player \d can see .+ \(in won@\d\)$/);
  });
});
