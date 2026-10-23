/**
 * What the built-in games give the round summary: each round's points by label,
 * whether the contract was made, and the score the game is played to. Checked
 * over seeded games against the game itself, not against the game file's
 * own expressions.
 */
import {
  createGame,
  type GameState,
  type OptionValue,
  type RoundResult,
  viewFor,
} from '@card-table/engine';
import { simulateGame } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames, type BuiltInGameName } from './index';
import { BASE_OPTIONS, RANDOM } from './simulation';

type TeamResult = RoundResult['teams'][number];

const PLAYERS: Record<BuiltInGameName, number> = {
  spades: 4,
  hearts: 4,
  euchre: 4,
  bridge: 4,
  pinochle: 4,
  'oh-hell': 4,
  canasta: 4,
  'gin-rummy': 2,
  rummy: 3,
  'crazy-eights': 3,
  cribbage: 2,
};

/** Seeded games played to the end, as the simulation tests play them. */
function play(game: BuiltInGameName, games: number): GameState[] {
  return Array.from({ length: games }, (_, i) => {
    return simulateGame(builtInGames[game], PLAYERS[game], `summary-${game}-${i}`, {
      ...(RANDOM[game] && { strategy: RANDOM[game] }),
      ...(BASE_OPTIONS[game] && { options: BASE_OPTIONS[game] }),
      holdNextRound: true,
      hiddenCardCheckEvery: 0,
    }).state;
  });
}

const labels = (team: TeamResult) => team.parts.map((p) => p.label);

/** Each team's total of numeric bids this round (nil counts as 0), as `team.bid`. */
function teamBid(round: RoundResult, state: GameState, team: number): number {
  return round.players
    .filter((p) => state.players[p.id]?.team === team)
    .reduce((sum, p) => sum + (typeof p.bid === 'number' ? p.bid : 0), 0);
}

describe('round summaries in the built-in games', { timeout: 60_000 }, () => {
  const games = Object.keys(PLAYERS) as BuiltInGameName[];

  it.each(games)("%s: a round's parts add up to its points, all labelled", (game) => {
    for (const state of play(game, 3)) {
      expect(state.history.length).toBeGreaterThan(0);
      for (const round of state.history) {
        for (const team of round.teams) {
          expect(team.parts.reduce((sum, p) => sum + p.points, 0)).toBe(team.points);
          // Every built-in game labels all its points.
          expect(labels(team)).not.toContain(null);
        }
      }
    }
  });

  it('spades: a team with a bid made it when it took that many tricks', () => {
    for (const state of play('spades', 4)) {
      for (const round of state.history) {
        for (const team of round.teams) {
          const bid = teamBid(round, state, team.id);
          expect(team.made).toBe(bid > 0 ? team.tricks >= bid : null);
          if (team.made === true && bid > 0) expect(labels(team)).toContain('Tricks');
          if (team.made === false) expect(labels(team)).toContain('Set');
        }
      }
    }
  });

  it('euchre: only the makers have a contract, and three tricks make it', () => {
    for (const state of play('euchre', 4)) {
      for (const round of state.history) {
        const makers = round.teams.filter((t) => t.made !== null);
        expect(makers).toHaveLength(1);
        const [maker] = makers as [TeamResult];
        expect(maker.made).toBe(maker.tricks >= 3);
        const defenders = round.teams.find((t) => t !== maker);
        if (maker.made === false) expect(labels(defenders as TeamResult)).toEqual(['Euchre']);
      }
    }
  });

  it('oh hell: made means the bid was exactly right', () => {
    for (const state of play('oh-hell', 2)) {
      for (const round of state.history) {
        for (const team of round.teams) {
          expect(team.made).toBe(team.tricks === teamBid(round, state, team.id));
          expect(labels(team).includes('Made the bid')).toBe(team.made);
        }
      }
    }
  });

  it('bridge: the declarers have the contract, and a set gives the defenders undertricks', () => {
    for (const state of play('bridge', 3)) {
      for (const round of state.history) {
        const declarers = round.teams.filter((t) => t.made !== null);
        // A deal everyone passes has no contract.
        expect(declarers.length).toBeLessThanOrEqual(1);
        const [declarer] = declarers;
        if (!declarer) continue;
        const defenders = round.teams.find((t) => t !== declarer) as TeamResult;
        if (declarer.made) expect(labels(declarer)).toContain('Tricks');
        else expect(labels(defenders)).toContain('Undertricks');
      }
    }
  });

  it("pinochle: the bidders' contract is set exactly when they lose their bid", () => {
    for (const state of play('pinochle', 3)) {
      for (const round of state.history) {
        const bidders = round.teams.filter((t) => t.made !== null);
        expect(bidders.length).toBeLessThanOrEqual(1);
        for (const team of bidders) expect(labels(team).includes('Set')).toBe(!team.made);
      }
    }
  });

  it('games without contracts never say made or set', () => {
    for (const game of ['hearts', 'gin-rummy', 'rummy', 'crazy-eights', 'canasta'] as const) {
      for (const round of play(game, 1)[0]?.history ?? []) {
        expect(round.teams.every((t) => t.made === null)).toBe(true);
      }
    }
  });

  it('gives the target score where a game has one', () => {
    const goal = (game: BuiltInGameName, options: Record<string, OptionValue> = {}) =>
      viewFor(createGame(builtInGames[game], options, PLAYERS[game], 'goal'), 0).goal;
    expect(goal('spades')).toEqual({ target: 500, winner: 'highestScore' });
    expect(goal('hearts')).toEqual({ target: 100, winner: 'lowestScore' });
    expect(goal('pinochle', { classic: true }).target).toBe(
      goal('pinochle', { classic: false }).target! * 10,
    );
    expect(goal('crazy-eights', { targetScore: 'oneHand' }).target).toBeNull();
    // Played to a number of rubbers or deals, not a score.
    expect(goal('bridge').target).toBeNull();
    expect(goal('oh-hell').target).toBeNull();
  });
});
