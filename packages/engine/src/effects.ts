/**
 * Effects: things the engine does after an action or a trick, as opposed to
 * choices a player makes.
 */
import { RANKS } from './cards/card';
import { trickWinnerIndex } from './cards/order';
import { ExprError, GameFileError } from './errors';
import { evaluate, evaluateCondition, evaluateNumber, type Value } from './expr/evaluate';
import { buildScope, PLAYER_PROPERTIES, type ScopeContext } from './game/scope';
import {
  type AfterAction,
  type GameState,
  nextActive,
  type PlayerState,
  type TeamState,
  trumpSuit,
  type VarValue,
  zoneCards,
  zoneKey,
} from './game/state';
import type { EffectDef } from './game/types';
import { cardCount, drawCards } from './game/zones';
import { layOutMelds } from './game/arrangement';
import { scoreNow } from './scoring';
import { layDownBonusCards } from './actions/cardMovement';

/**
 * Runs effects in order. Returns true if one of them is waiting for a
 * player's choice (the rest run once the choice is made), or if points scored
 * ended the game (the rest never run).
 */
export function runEffects(
  state: GameState,
  effects: readonly EffectDef[],
  ctx: ScopeContext,
  after: AfterAction,
): boolean {
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i] as EffectDef;
    if (effect.if && !evaluateCondition(effect.if, buildScope(state, ctx))) continue;

    if (effect.ask !== undefined) {
      if (ctx.player === undefined) {
        throw new GameFileError(`"ask" can only be used in an action's effects`);
      }
      const seat = evaluate(effect.ask, buildScope(state, ctx));
      if (typeof seat !== 'number' || !state.players[seat]) {
        throw new GameFileError(`ask "${effect.ask}" gave ${JSON.stringify(seat)}, not a seat`);
      }
      state.pending = {
        kind: 'ask',
        player: seat,
        asker: ctx.player,
        values: [...(effect.values ?? [])],
        target: typeof effect.set === 'string' ? effect.set : 'state.answer',
        remaining: effects.slice(i + 1),
        card: ctx.card?.id ?? null,
        after,
      };
      return true;
    }

    if (effect.choose) {
      if (effect.choose !== 'suit' || typeof effect.set !== 'string') {
        throw new GameFileError(`"choose" needs "set": "state.<name>" to store the choice`);
      }
      if (ctx.player === undefined) {
        throw new GameFileError(`"choose" can only be used in an action's effects`);
      }
      state.pending = {
        kind: 'chooseSuit',
        player: ctx.player,
        target: effect.set,
        remaining: effects.slice(i + 1),
        card: ctx.card?.id ?? null,
        after,
      };
      return true;
    }

    if (effect.set !== undefined && effect.ask === undefined) applySet(state, effect.set, ctx);
    if (effect.resolveTrick) resolveTrick(state, effect.resolveTrick);
    if (effect.moveTrick) moveTrick(state, effect.moveTrick);
    if (effect.nextPlayer) nextPlayerEffect(state, effect.nextPlayer, ctx);
    if (effect.skip) state.cursor.skipNext++;
    if (effect.reverse) state.cursor.direction = state.cursor.direction === 1 ? -1 : 1;
    if (effect.breakSuit) state.vars[`${effect.breakSuit}Broken`] = true;
    if (effect.sitOut !== undefined) sitOut(state, effect.sitOut, ctx);
    if (effect.returnCards) returnCards(state, effect.returnCards, effect.to ?? 'hand');
    if (effect.score !== undefined) {
      if (ctx.player === undefined) {
        throw new GameFileError('"score" can only be used in an action\'s effects');
      }
      const points = evaluateNumber(effect.score, buildScope(state, ctx));
      // Nothing to note when there are no points (a hand with no pairs, say).
      const into = effect.into ?? null;
      if (points !== 0 && scoreNow(state, ctx.player, points, effect.label ?? null, into)) {
        return true;
      }
    }
    if (effect.layOutMelds) {
      if (ctx.player === undefined) {
        throw new GameFileError('"layOutMelds" can only be used in an action\'s effects');
      }
      layOutMelds(state, ctx.player, effect.layOutMelds);
    }
    // winnerLeads: the trick winner leading the next trick is already the default.
  }
  return false;
}

/** Gives each card in a shared pile back to the player who played it, into their `to` zone. */
function returnCards(state: GameState, from: string, to: string): void {
  const source = zoneCards(state, zoneKey(state, from, null));
  for (const card of source) {
    const owner = state.playedBy[card.id];
    if (owner === undefined) {
      throw new GameFileError(`Nobody played ${card.id} into "${from}", so it can't be returned`);
    }
    zoneCards(state, zoneKey(state, to, owner)).push(card);
  }
  source.length = 0;
}

/** Takes a seat out of play until the round ends (a lone player's partner). */
function sitOut(state: GameState, seat: string, ctx: ScopeContext): void {
  const value = evaluate(seat, buildScope(state, ctx));
  const player = typeof value === 'number' ? state.players[value] : undefined;
  if (!player)
    throw new GameFileError(`sitOut "${seat}" gave ${JSON.stringify(value)}, not a seat`);
  player.sittingOut = true;
}

/** Sets custom values from a `set` (in effects or setup.flip). */
export function applySet(
  state: GameState,
  set: NonNullable<EffectDef['set']>,
  ctx: ScopeContext,
): void {
  if (typeof set === 'string') {
    setVar(state, set, true, ctx.player);
    return;
  }
  for (const [path, expr] of Object.entries(set)) {
    const value = typeof expr === 'string' ? evaluate(expr, buildScope(state, ctx)) : expr;
    setVar(state, path, toVarValue(value, path), ctx.player);
  }
}

/** Sets "state.x", or "player.x" for the player in question. */
export function setVar(state: GameState, path: string, value: VarValue, player?: number): void {
  const match = /^(state|player)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path);
  if (!match) {
    throw new GameFileError(`Can only set "state.<name>" or "player.<name>" values, not "${path}"`);
  }
  const name = match[2] as string;
  if (match[1] === 'state') {
    state.vars[name] = value;
    return;
  }
  const target = player === undefined ? undefined : state.players[player];
  if (!target) throw new GameFileError(`"${path}" needs a player, and there is none here`);
  if (PLAYER_PROPERTIES.includes(name) || Object.hasOwn(state.file.zones, name)) {
    throw new GameFileError(`"${path}" is already something else; pick another name`);
  }
  target.vars[name] = value;
}

function toVarValue(value: Value, path: string): VarValue {
  if (Array.isArray(value)) return (value as readonly Value[]).map((v) => toVarValue(v, path));
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    throw new ExprError(`${path} can only hold numbers, text, true/false, null or lists`);
  }
  return value;
}

function resolveTrick(state: GameState, rule: NonNullable<EffectDef['resolveTrick']>): void {
  const trick = state.trick;
  if (!trick || trick.plays.length === 0) throw new GameFileError('No trick to resolve');
  const ranks = state.file.cardOrder?.ranks ?? RANKS;
  const index = trickWinnerIndex(
    trick.plays.map((p) => p.card),
    rule,
    trumpSuit(state),
    ranks,
    state.file.cardOrder?.bowers === true,
  );
  const winner = (trick.plays[index] as { player: number }).player;
  trick.winner = winner;
  const player = state.players[winner] as PlayerState;
  player.tricks++;
  (state.teams[player.team] as TeamState).tricks++;
}

function moveTrick(state: GameState, zoneName: string): void {
  const trick = state.trick;
  if (!trick || trick.winner === null) {
    throw new GameFileError('"moveTrick" must come after "resolveTrick"');
  }
  const ids = new Set(trick.plays.map((p) => p.card.id));
  const source = zoneCards(state, trick.zone);
  const moving = source.filter((c) => ids.has(c.id));
  state.zones[trick.zone] = source.filter((c) => !ids.has(c.id));
  // A per-team zone resolves to the winner's team; a per-player zone to the winner.
  zoneCards(state, zoneKey(state, zoneName, trick.winner)).push(...moving);
}

function nextPlayerEffect(
  state: GameState,
  effect: NonNullable<EffectDef['nextPlayer']>,
  ctx: ScopeContext,
): void {
  const target = nextActive(state, ctx.player ?? state.cursor.current, state.cursor.direction);
  if (effect.draw) {
    drawCards(
      state,
      zoneKey(state, effect.from ?? 'stock', target),
      zoneKey(state, 'hand', target),
      cardCount(state, effect.draw, ctx),
    );
    layDownBonusCards(state, target, true);
  }
  if (effect.skip) state.cursor.skipNext++;
}
