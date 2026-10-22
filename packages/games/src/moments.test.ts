/**
 * The big moments in the built-in games ("Euchred!", "Canasta!"): over many
 * seeded games, each one happens, and only when it should. Checked after every
 * move against the game itself, not against the moment's own expression.
 */
import type { GameState, MomentEvent } from '@card-table/engine';
import { simulateGame } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames, type BuiltInGameName } from './index';
import { RANDOM } from './simulation';

/**
 * Plays seeded games as the simulation tests do, checking each new moment as
 * the move that made it is played. Returns every moment's label, in order.
 */
function playChecking(
  game: BuiltInGameName,
  players: number,
  games: number,
  check: (moment: MomentEvent, state: GameState, before: GameState | null) => void,
): string[] {
  const seen: string[] = [];
  for (let i = 0; i < games; i++) {
    let before: GameState | null = null;
    simulateGame(builtInGames[game], players, `moments-${game}-${i}`, {
      ...(RANDOM[game] && { strategy: RANDOM[game] }),
      // As the server plays: a round's end is seen before the next deal.
      holdNextRound: true,
      // The simulation tests look for hidden cards; here it would only slow things down.
      hiddenCardCheckEvery: 0,
      check: (state) => {
        for (const moment of state.moments.slice(before?.moments.length ?? 0)) {
          check(moment, state, before);
          seen.push(moment.label);
        }
        before = state;
      },
    });
  }
  return seen;
}

const teamTricks = (state: GameState, team: number | null) => state.teams[team ?? -1]?.tricks;

// Whole games, several per test.
describe('big moments in the built-in games', { timeout: 60_000 }, () => {
  it('spades: nil broken, and a team set at the end of the hand', () => {
    const seen = playChecking('spades', 4, 15, (moment, state) => {
      const player = state.players[moment.player ?? -1];
      if (moment.label === 'Nil broken') {
        expect(player?.bid).toBe('nil');
        expect(player?.tricks).toBe(1);
      } else if (moment.label === 'Set!') {
        const team = state.teams[moment.team ?? -1];
        const bid = team?.players.reduce((sum, p) => {
          const b = state.players[p]?.bid;
          return sum + (typeof b === 'number' ? b : 0);
        }, 0);
        expect(team && bid !== undefined && team.tricks < bid).toBe(true);
        expect(state.status).not.toBe('inProgress');
      }
    });
    expect(seen).toContain('Nil broken');
    expect(seen).toContain('Set!');
  });

  it('hearts: hearts broken at most once a hand', () => {
    const seen = playChecking('hearts', 4, 6, (moment, state, before) => {
      if (moment.label !== '♥ Hearts broken') return;
      expect(state.vars.heartsBroken).toBe(true);
      expect(before?.round === state.round && before.vars.heartsBroken === true).toBe(false);
    });
    expect(seen).toContain('♥ Hearts broken');
  });

  it('euchre: euchred on the defenders’ third trick, a march on the fifth', () => {
    const seen = playChecking('euchre', 4, 25, (moment, state) => {
      const maker = state.vars.makerTeam;
      if (moment.label === 'Euchred!') {
        expect(moment.team).not.toBe(maker);
        expect(teamTricks(state, moment.team)).toBe(3);
      } else if (moment.label === 'March!') {
        expect(moment.team).toBe(maker);
        expect(teamTricks(state, moment.team)).toBe(5);
      }
    });
    expect(seen).toContain('Euchred!');
    expect(seen).toContain('March!');
  });

  it('gin rummy: gin for the player who went out with no deadwood', () => {
    const seen = playChecking('gin-rummy', 2, 10, (moment, state) => {
      expect(['Gin!', 'Big gin!']).toContain(moment.label);
      expect(state.vars.knocker).toBe(moment.player);
    });
    expect(seen).toContain('Gin!');
  });

  it('canasta: one "Canasta!" for each meld reaching seven cards', () => {
    const seen = playChecking('canasta', 4, 3, (moment, state, before) => {
      expect(moment.label).toBe('Canasta!');
      const sevens = (s: GameState | null) =>
        (s?.melds[`melds@t${moment.team}`] ?? []).filter((m) => m.length >= 7).length;
      expect(sevens(state)).toBeGreaterThan(sevens(before));
    });
    expect(seen).toContain('Canasta!');
  });
});
