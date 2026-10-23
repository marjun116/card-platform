import { ExprError } from './errors';
import { evaluateCondition, evaluateNumber } from './expr/evaluate';
import { buildScope, type ScopeContext } from './game/scope';
import type { PlayerId } from './game/move';
import { resolveSetting } from './game/settings';
import { TIES, WINNERS } from './schema/gameFile';
import type { GameState, PlayerState, RoundResult, TeamState } from './game/state';
import type { ScoreRuleDef } from './game/types';

/**
 * Scores the round, applies elimination and checks the end condition.
 * Returns true if the game is over.
 */
export function scoreRound(state: GameState): boolean {
  const { scoring, elimination } = state.file;
  const liveTeams = state.teams.filter((t) => t.players.some((p) => state.players[p]?.active));
  const activeBefore = state.players.map((p) => p.active);
  // Before the rules run, so a contract reads the round as it was played.
  const made = state.teams.map((team) =>
    liveTeams.includes(team) ? contractMade(state, team) : null,
  );

  for (const team of liveTeams) {
    for (const rule of scoring.perTeam ?? []) applyRule(state, rule, { team: team.id }, team, team);
  }
  applyPlayerRules(state, scoring.perPlayer ?? []);

  if (elimination) {
    const active = state.players.filter((p) => p.active);
    const out = active.filter((p) =>
      evaluateCondition(elimination.when, buildScope(state, { player: p.id })),
    );
    // If everyone would be knocked out at once, nobody is.
    if (out.length < active.length) for (const p of out) p.active = false;
  }

  const winners = decideEnd(state);
  recordRound(state, activeBefore, made);
  if (winners === null) return false;
  finishGame(state, winners);
  return true;
}

/**
 * Points scored during a round (a `score` effect): added to the player's team
 * straight away and noted for the game log. With `endCondition.immediate`, the
 * game ends the moment its end condition holds; returns true if it did.
 */
export function scoreNow(
  state: GameState,
  player: PlayerId,
  points: number,
  label: string | null,
  into: string | null = null,
): boolean {
  const team = state.teams[state.players[player]?.team ?? -1];
  if (!team) throw new ExprError(`There is no player ${player} to score for`);
  state.scoreEvents.push({
    round: state.round,
    at: state.log.length,
    player,
    team: team.id,
    points,
    label,
    into,
  });
  // Held points (such as meld) wait for the round's scoring to decide whether they count.
  if (into !== null) {
    team.held[into] = (team.held[into] ?? 0) + points;
    return false;
  }
  team.score += points;
  state.roundPoints.push({ team: team.id, label, points });
  if (!state.file.endCondition.immediate) return false;
  const winners = decideEnd(state);
  if (winners === null) return false;
  // The round stops here; it's recorded with the points scored so far.
  recordRound(
    state,
    state.players.map((p) => p.active),
    state.teams.map(() => null),
  );
  finishGame(state, winners);
  return true;
}

/**
 * If the end condition holds, runs the end-of-game rules (bonuses) and
 * returns the winners. Returns null if the game goes on: the condition doesn't
 * hold, or a tie means play goes on (then the bonuses are undone).
 */
function decideEnd(state: GameState): PlayerId[] | null {
  if (!evaluateCondition(state.file.endCondition.when, buildScope(state))) return null;
  const beforeBonuses = state.teams.map((t) => ({ score: t.score, tracks: { ...t.tracks } }));
  const playersBefore = state.players.map((p) => ({ ...p.tracks }));
  const pointsBefore = state.roundPoints.length;
  applyPlayerRules(state, state.file.scoring.atGameEnd ?? []);
  const winners = findWinners(state);
  if (winners === null) {
    state.teams.forEach((t, i) => Object.assign(t, beforeBonuses[i]));
    state.players.forEach((p, i) => (p.tracks = playersBefore[i] ?? {}));
    state.roundPoints = state.roundPoints.slice(0, pointsBefore);
  }
  return winners;
}

function finishGame(state: GameState, winners: PlayerId[]): void {
  state.status = 'over';
  state.winners = winners;
  state.notes = (state.file.endCondition.notes ?? [])
    .filter((note) => evaluateCondition(note.if, buildScope(state)))
    .map((note) => note.text);
}

/** Whether a team made its contract (`scoring.contract`); null if it had none. */
function contractMade(state: GameState, team: TeamState): boolean | null {
  const { contract } = state.file.scoring;
  if (!contract) return null;
  const scope = buildScope(state, { team: team.id });
  if (contract.if && !evaluateCondition(contract.if, scope)) return null;
  return evaluateCondition(contract.made, scope);
}

/** A team's points this round by label, in the order first scored, leaving out 0s. */
function partsOf(state: GameState, team: number): RoundResult['teams'][number]['parts'] {
  const parts: RoundResult['teams'][number]['parts'] = [];
  for (const { team: id, label, points } of state.roundPoints) {
    if (id !== team) continue;
    const part = parts.find((p) => p.label === label);
    if (part) part.points += points;
    else parts.push({ label, points });
  }
  return parts.filter((p) => p.points !== 0);
}

/** Adds the round to the history (points count from the round's start). */
function recordRound(state: GameState, activeBefore: boolean[], made: (boolean | null)[]): void {
  state.history.push({
    round: state.round,
    dealer: state.dealer,
    teams: state.teams.map((t, i) => ({
      id: t.id,
      points: t.score - (state.roundStartScores[i] ?? 0),
      score: t.score,
      tricks: t.tricks,
      tracks: { ...t.tracks },
      held: { ...t.held },
      parts: partsOf(state, t.id),
      made: made[i] ?? null,
    })),
    players: state.players.map((p, i) => ({
      id: p.id,
      bid: p.bid,
      tricks: p.tricks,
      tracks: { ...p.tracks },
      eliminated: (activeBefore[i] ?? false) && !p.active,
    })),
  });
}

/** Runs each rule for each active player, in seat order. */
function applyPlayerRules(state: GameState, rules: readonly ScoreRuleDef[]): void {
  for (const player of state.players.filter((p) => p.active)) {
    const team = state.teams[player.team] as TeamState;
    for (const rule of rules) {
      applyRule(state, rule, { player: player.id }, team, rule.to === 'team' ? team : player);
    }
  }
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
  if (add !== 0) state.roundPoints.push({ team: team.id, label: rule.label ?? null, points: add });
  for (const [name, delta] of tracks) tracker.tracks[name] = (tracker.tracks[name] ?? 0) + delta;
}

/** Winning seats, or null if the game should continue (a tie under "playOn"). */
function findWinners(state: GameState): PlayerId[] | null {
  const winner = resolveSetting(state, state.file.endCondition.winner, WINNERS, 'Winner');
  const ties = resolveSetting(state, state.file.endCondition.ties ?? 'playOn', TIES, 'Ties');
  const shareOrNull = (seats: PlayerId[]) =>
    seats.length > 1 && ties === 'playOn' ? null : seats.sort((a, b) => a - b);

  if (winner === 'lastActivePlayer') {
    const active = state.players.filter((p) => p.active).map((p) => p.id);
    return shareOrNull(active);
  }

  // Teams meeting `priority` (say, the bidding team when both teams pass the target) win
  // ahead of the rest.
  const priority = state.file.endCondition.priority;
  const live = state.teams.filter((t) => t.players.some((p) => state.players[p]?.active));
  const first = priority
    ? live.filter((t) => evaluateCondition(priority, buildScope(state, { team: t.id })))
    : [];
  const candidates = first.length > 0 ? first : state.teams;
  const scores = candidates.map((t) => t.score);
  const best = winner === 'highestScore' ? Math.max(...scores) : Math.min(...scores);
  const top = candidates.filter((t) => t.score === best);
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
