import { evaluateCondition, evaluateNumber } from './expr/evaluate';
import { buildScope, type ScopeContext } from './game/scope';
import type { PlayerId } from './game/move';
import type { GameState, PlayerState, TeamState } from './game/state';
import type { ScoreRuleDef } from './game/types';

/**
 * Scores the round, applies elimination and checks the end condition.
 * Returns true if the game is over.
 */
export function scoreRound(state: GameState): boolean {
  const { scoring, elimination, endCondition } = state.file;
  const liveTeams = state.teams.filter((t) => t.players.some((p) => state.players[p]?.active));
  const scoresBefore = state.teams.map((t) => t.score);
  const activeBefore = state.players.map((p) => p.active);

  for (const team of liveTeams) {
    for (const rule of scoring.perTeam ?? []) applyRule(state, rule, { team: team.id }, team, team);
  }
  for (const player of state.players.filter((p) => p.active)) {
    const team = state.teams[player.team] as TeamState;
    for (const rule of scoring.perPlayer ?? []) {
      applyRule(state, rule, { player: player.id }, team, rule.to === 'team' ? team : player);
    }
  }

  if (elimination) {
    const active = state.players.filter((p) => p.active);
    const out = active.filter((p) =>
      evaluateCondition(elimination.when, buildScope(state, { player: p.id })),
    );
    // If everyone would be knocked out at once, nobody is.
    if (out.length < active.length) for (const p of out) p.active = false;
  }

  state.history.push({
    round: state.round,
    dealer: state.dealer,
    teams: state.teams.map((t, i) => ({
      id: t.id,
      points: t.score - (scoresBefore[i] ?? 0),
      score: t.score,
      tricks: t.tricks,
      tracks: { ...t.tracks },
    })),
    players: state.players.map((p, i) => ({
      id: p.id,
      bid: p.bid,
      tricks: p.tricks,
      tracks: { ...p.tracks },
      eliminated: (activeBefore[i] ?? false) && !p.active,
    })),
  });

  if (!evaluateCondition(endCondition.when, buildScope(state))) return false;
  const winners = findWinners(state);
  if (winners === null) return false;
  state.status = 'over';
  state.winners = winners;
  return true;
}

function applyRule(
  state: GameState,
  rule: ScoreRuleDef,
  ctx: ScopeContext,
  team: TeamState,
  tracker: TeamState | PlayerState,
): void {
  const scope = () => buildScope(state, ctx);
  if (rule.if && !evaluateCondition(rule.if, scope())) return;
  // Evaluate everything before changing anything, so `add` and `track` see the same values.
  const add = rule.add === undefined ? 0 : evaluateNumber(rule.add, scope());
  const tracks = Object.entries(rule.track ?? {}).map(([name, expr]): [string, number] => [
    name,
    evaluateNumber(expr, scope()),
  ]);
  team.score += add;
  for (const [name, delta] of tracks) tracker.tracks[name] = (tracker.tracks[name] ?? 0) + delta;
}

/** Winning seats, or null if the game should continue (a tie under "playOn"). */
function findWinners(state: GameState): PlayerId[] | null {
  const { winner, ties = 'playOn' } = state.file.endCondition;
  const shareOrNull = (seats: PlayerId[]) =>
    seats.length > 1 && ties === 'playOn' ? null : seats.sort((a, b) => a - b);

  if (winner === 'lastActivePlayer') {
    const active = state.players.filter((p) => p.active).map((p) => p.id);
    return shareOrNull(active);
  }

  const scores = state.teams.map((t) => t.score);
  const best = winner === 'highestScore' ? Math.max(...scores) : Math.min(...scores);
  const top = state.teams.filter((t) => t.score === best);
  if (top.length > 1 && ties === 'playOn') return null;
  return top.flatMap((t) => t.players).sort((a, b) => a - b);
}

export interface Scores {
  teams: { team: number; players: PlayerId[]; score: number }[];
  players: { player: PlayerId; team: number; score: number; active: boolean }[];
}

export function getScores(state: GameState): Scores {
  return {
    teams: state.teams.map((t) => ({ team: t.id, players: [...t.players], score: t.score })),
    players: state.players.map((p) => ({
      player: p.id,
      team: p.team,
      score: (state.teams[p.team] as TeamState).score,
      active: p.active,
    })),
  };
}
