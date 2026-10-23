/**
 * What the round summary needs from the engine: where each round's points came
 * from (`label` on scoring rules and score events), whether a team made its
 * contract (`scoring.contract`), and the score the game is played to
 * (`endCondition.target`).
 */
import { describe, expect, it } from 'vitest';
import { counting, spades, tinyTricks } from './__fixtures__/games';
import { applyMove, createGame, getLegalMoves, playersToAct, viewFor } from './api';
import type { GameState } from './game/state';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';

/** Plays each seat's first legal move until `done` says stop. */
function playUntil(state: GameState, done: (s: GameState) => boolean): GameState {
  while (!done(state) && state.status === 'inProgress') {
    const seat = playersToAct(state)[0] as number;
    const move = getLegalMoves(state, seat)[0];
    if (!move) throw new Error(`Seat ${seat} has no legal move`);
    state = applyMove(state, move);
  }
  return state;
}

const sum = (parts: { points: number }[]) => parts.reduce((total, p) => total + p.points, 0);

/** Spades with its scoring split by label, and a contract. */
const labelled: GameFile = {
  ...spades,
  scoring: {
    perTeam: [
      { label: 'Tricks', if: 'team.tricks >= team.bid', add: 'team.bid * 10' },
      {
        label: 'Bags',
        if: 'team.tricks >= team.bid',
        add: 'team.tricks - team.bid',
        track: { bags: 'team.tricks - team.bid' },
      },
      { label: 'Set', if: 'team.tricks < team.bid', add: '-team.bid * 10' },
      { label: 'Bag penalty', if: 'team.bags >= 10', add: -100, track: { bags: -10 } },
    ],
    perPlayer: [
      { if: "player.bid == 'nil'", add: 'player.tricks == 0 ? 100 : -100', to: 'team' },
      { if: "player.bid == 'blindNil'", add: 'player.tricks == 0 ? 200 : -200', to: 'team' },
    ],
    contract: { if: 'team.bid > 0', made: 'team.tricks >= team.bid' },
  },
  endCondition: { ...spades.endCondition, target: 'options.targetScore' },
};

describe('where the points came from', () => {
  const state = playUntil(createGame(labelled, {}, 4, 'parts'), (s) => s.history.length === 4);

  it('adds up to the round points, team by team', () => {
    for (const round of state.history) {
      for (const team of round.teams) expect(sum(team.parts)).toBe(team.points);
    }
  });

  it('uses the rules labels, in the order scored, without parts of 0', () => {
    for (const round of state.history) {
      for (const team of round.teams) {
        for (const part of team.parts) {
          expect(part.points).not.toBe(0);
          expect([null, 'Tricks', 'Bags', 'Set', 'Bag penalty']).toContain(part.label);
        }
        const labels = team.parts.map((p) => p.label);
        expect(new Set(labels).size).toBe(labels.length);
        if (labels.includes('Tricks') && labels.includes('Bags')) {
          expect(labels.indexOf('Tricks')).toBeLessThan(labels.indexOf('Bags'));
        }
      }
    }
  });

  it('leaves the label null for unlabelled rules', () => {
    const plain = playUntil(createGame(tinyTricks, {}, 2, 'parts'), (s) => s.status === 'over');
    for (const team of plain.history[0]?.teams ?? []) {
      expect(team.parts).toEqual(team.points === 0 ? [] : [{ label: null, points: team.points }]);
    }
  });

  it('counts points scored during play under their own labels', () => {
    const lateEnd: GameFile = {
      ...counting,
      endCondition: { ...counting.endCondition, immediate: false },
    };
    const played = playUntil(createGame(lateEnd, {}, 2, 'parts'), (s) => s.history.length === 1);
    const round = played.history[0];
    expect(round).toBeDefined();
    const scored = played.scoreEvents.filter((e) => e.round === 1 && e.into === null);
    for (const team of round?.teams ?? []) {
      expect(sum(team.parts)).toBe(team.points);
      const labels = new Set(scored.filter((e) => e.team === team.id).map((e) => e.label));
      for (const part of team.parts) expect(labels.has(part.label)).toBe(true);
    }
  });
});

describe('contracts', () => {
  it('says whether each team made its bid', () => {
    const state = playUntil(createGame(labelled, {}, 4, 'made'), (s) => s.history.length === 4);
    for (const round of state.history) {
      for (const team of round.teams) {
        const players = round.players.filter((p) => p.id % 2 === team.id);
        const bid = players.reduce((n, p) => n + (typeof p.bid === 'number' ? p.bid : 0), 0);
        const tricks = players.reduce((n, p) => n + p.tricks, 0);
        expect(team.made).toBe(bid > 0 ? tricks >= bid : null);
      }
    }
  });

  it('is null for every team in a game without contracts', () => {
    const state = playUntil(createGame(spades, {}, 4, 'made'), (s) => s.history.length === 1);
    expect(state.history[0]?.teams.map((t) => t.made)).toEqual([null, null]);
  });

  it('checks the contract before the round is scored', () => {
    // Bags are tracked by the scoring rules; the contract sees them as they were.
    const file: GameFile = {
      ...labelled,
      scoring: { ...labelled.scoring, contract: { made: 'team.bags == 0' } },
    };
    const state = playUntil(createGame(file, {}, 4, 'made'), (s) => s.history.length === 1);
    expect(state.history[0]?.teams.map((t) => t.made)).toEqual([true, true]);
  });
});

describe('the goal', () => {
  it('gives the target score and which way wins', () => {
    const view = viewFor(createGame(labelled, { targetScore: 300 }, 4, 'goal'), 0);
    expect(view.goal).toEqual({ target: 300, winner: 'highestScore' });
  });

  it('has no target without one in the game file', () => {
    expect(viewFor(createGame(spades, {}, 4, 'goal'), 0).goal.target).toBeNull();
  });

  it('takes a plain number', () => {
    const file: GameFile = { ...spades, endCondition: { ...spades.endCondition, target: 250 } };
    expect(viewFor(createGame(file, {}, 4, 'goal'), 0).goal.target).toBe(250);
  });
});

describe('validation', () => {
  const issues = (file: GameFile) => {
    const result = validate(file);
    return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
  };

  it('accepts labels, a contract and a target', () => {
    expect(issues(labelled)).toEqual([]);
  });

  it('checks the contract as a team condition', () => {
    const file: GameFile = {
      ...labelled,
      scoring: { ...labelled.scoring, contract: { made: 'player.tricks > 0' } },
    };
    expect(issues(file).join('\n')).toContain('scoring.contract.made');
  });

  it('keeps the target to values everyone can see', () => {
    const file: GameFile = {
      ...labelled,
      endCondition: { ...labelled.endCondition, target: "holderOf('QS') == 0 ? 500 : 300" },
    };
    expect(issues(file).join('\n')).toContain(
      'endCondition.target: The target score is shown to everyone',
    );
  });
});
