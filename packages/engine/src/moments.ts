/**
 * Big moments (the game file's `moments`): "♥ Hearts broken", "Canasta!".
 * Each is read just before a move and again once the move has settled (after
 * any round scoring, before the next deal). A `when` moment happens when its
 * condition turns true; an `each` moment, each time its number goes up. With
 * `per`, every player (or team) is read on their own and the moment is theirs.
 *
 * Nothing is stored between moves but the moments that happened, so a value
 * that resets with the round (state, tricks, melds) can happen again next round.
 *
 * A moment is only a banner, so one that can't be worked out right now (a value
 * not set yet: "state.total >= 10" while state.total is null) simply hasn't
 * happened, rather than stopping the game.
 */
import { ExprError } from './errors';
import { evaluateCondition, evaluateNumber } from './expr/evaluate';
import { buildScope, type ScopeContext } from './game/scope';
import type { GameState } from './game/state';
import type { MomentDef } from './game/types';

/** Each moment's value for each player, team or (without `per`) the table; null if unknown. */
export type MomentReading = (boolean | number | null)[][];

/** Who a moment is read for, in a fixed order so two readings line up. */
function scopesFor(state: GameState, moment: MomentDef): ScopeContext[] {
  if (moment.per === 'player') return state.players.map((p) => ({ player: p.id }));
  if (moment.per === 'team') return state.teams.map((t) => ({ team: t.id }));
  return [{}];
}

/** Reads every moment now; null in a game without moments. */
export function readMoments(state: GameState): MomentReading | null {
  const moments = state.file.moments;
  if (!moments) return null;
  return moments.map((moment) =>
    scopesFor(state, moment).map((ctx) => {
      const scope = buildScope(state, ctx);
      try {
        return moment.when !== undefined
          ? evaluateCondition(moment.when, scope)
          : evaluateNumber(moment.each ?? '0', scope);
      } catch (error) {
        if (error instanceof ExprError) return null;
        throw error;
      }
    }),
  );
}

/** Notes the moments that happened since `before` was read. */
export function noteMoments(state: GameState, before: MomentReading | null): void {
  const moments = state.file.moments;
  const after = readMoments(state);
  if (!moments || !before || !after) return;
  moments.forEach((moment, m) => {
    const scopes = scopesFor(state, moment);
    scopes.forEach((ctx, i) => {
      const was = before[m]?.[i];
      const now = after[m]?.[i];
      const happened =
        typeof now === 'number' ? typeof was === 'number' && now > was : now === true && !was;
      if (!happened || !inPlay(state, ctx)) return;
      const player = ctx.player ?? null;
      state.moments.push({
        round: state.round,
        at: state.log.length,
        label: moment.label,
        player,
        team: ctx.team ?? (player === null ? null : (state.players[player]?.team ?? null)),
      });
    });
  });
}

/** Players knocked out (and teams with nobody left) have no moments. */
function inPlay(state: GameState, ctx: ScopeContext): boolean {
  if (ctx.player !== undefined) return state.players[ctx.player]?.active ?? false;
  if (ctx.team !== undefined) {
    return state.teams[ctx.team]?.players.some((p) => state.players[p]?.active) ?? false;
  }
  return true;
}
