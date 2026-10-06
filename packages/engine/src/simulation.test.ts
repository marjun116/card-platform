/**
 * Random-play smoke test: every fixture game, many seeds, random legal moves
 * to the end. Checks after every move that no cards appear or vanish and
 * exactly one player is expected to act; every so often, that no player's
 * view contains another player's hidden cards. (Phase 2 turns this into the
 * full 1,000-game simulation for built-in games.)
 */
import { describe, expect, it } from 'vitest';
import { allFixtures } from './__fixtures__/games';
import { simulate } from './__fixtures__/simulate';
import { replay, viewFor } from './api';
import type { Move } from './game/move';
import type { GameState } from './game/state';

const PLAYERS: Record<keyof typeof allFixtures, number[]> = {
  spades: [4],
  sevensUp: [2, 3, 6],
  tinyTricks: [2],
  miniRummy: [2, 4],
  passing: [4],
};
const SEEDS: Record<keyof typeof allFixtures, number> = {
  spades: 3,
  sevensUp: 10,
  tinyTricks: 20,
  miniRummy: 5,
  passing: 5,
};

/**
 * Purely random play can go on forever in some games (spades teams that always
 * overbid, rummy players who never meld), so this player is a little sensible:
 * it bids low and melds whenever it can. Everything else is random.
 */
function sensible(moves: Move[], pick: (n: number) => number): Move {
  const low = moves.filter((m) => m.type === 'bid' && typeof m.value === 'number' && m.value <= 3);
  const melds = moves.filter((m) => m.type === 'meld' || m.type === 'layOff');
  const pool = low.length > 0 ? low : melds.length > 0 ? melds : moves;
  return pool[pick(pool.length)] as Move;
}

function checkHiddenCards(state: GameState, moveNumber: number) {
  if (moveNumber % 25 !== 0) return;
  for (const viewer of state.players) {
    // The log is left out: it names cards that were public when played (an earlier
    // round, the face-up discard pile) or that the viewer passed themselves, which
    // says nothing about where they are now. Log redaction has its own tests.
    const current = { ...viewFor(state, viewer.id), log: [] };
    const view = JSON.stringify(current);
    for (const [key, cards] of Object.entries(state.zones)) {
      if (!key.startsWith('hand@') || key === `hand@${viewer.id}`) continue;
      for (const card of cards) {
        if (view.includes(`"${card.id}"`)) {
          throw new Error(`Player ${viewer.id} can see ${card.id} in ${key}`);
        }
      }
    }
  }
}

describe('random play', () => {
  for (const [name, file] of Object.entries(allFixtures)) {
    const key = name as keyof typeof allFixtures;
    for (const players of PLAYERS[key]) {
      it(`${name} with ${players} players finishes cleanly`, () => {
        for (let i = 0; i < SEEDS[key]; i++) {
          const seed = `${name}-${players}-${i}`;
          const { state, moves } = simulate(file, players, seed, {
            choose: sensible,
            check: checkHiddenCards,
          });
          expect(state.status).toBe('over');
          expect(state.winners.length).toBeGreaterThan(0);
          // The seed and move list fully describe the game.
          expect(replay(file, {}, players, seed, moves)).toEqual(state);
        }
      });
    }
  }
});
