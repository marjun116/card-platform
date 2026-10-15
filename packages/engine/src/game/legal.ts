import { SUITS } from '../cards/card';
import { ExprError, GameFileError } from '../errors';
import { evaluate } from '../expr/evaluate';
import { ACTION_TYPES } from '../schema/gameFile';
import { actionMoves, allowsCard } from '../actions';
import { type Move, moveKey, type PlayerId } from './move';
import { findCard } from './cards';
import { autoArrangeAllowed } from './arrangement';
import { buildScope } from './scope';
import { type GameState, isPlaying } from './state';
import type { ActionDef, PhaseDef, TurnStepDef } from './types';

/** A legal move plus where it came from, so applyMove knows which rule it follows. */
export interface Candidate {
  move: Move;
  /** Turn step the move belongs to (-1 for moves outside the step structure). */
  step: number;
  action: ActionDef | null;
}

export function currentPhase(state: GameState): PhaseDef {
  const phase = state.file.phases[state.cursor.phase];
  if (!phase) throw new Error(`No phase ${state.cursor.phase}`);
  return phase;
}

export function turnSteps(phase: PhaseDef): TurnStepDef[] {
  return phase.turn ?? [{ actions: phase.actions ?? [] }];
}

export function isTrickPhase(phase: PhaseDef): boolean {
  return turnSteps(phase).some((s) => s.actions.some((a) => a.type === 'playToTrick'));
}

interface CandidateOptions {
  /** Only consider these action types (used for hasLegalPlay). */
  only?: readonly ActionDef['type'][];
  /** Leave out lookAtHand, which never takes a turn. */
  skipLook?: boolean;
  /** Generate moves even if it isn't this player's turn. */
  ignoreTurn?: boolean;
}

export function candidates(
  state: GameState,
  player: PlayerId,
  opts: CandidateOptions = {},
): Candidate[] {
  if (state.status !== 'inProgress' || !isPlaying(state.players[player])) return [];
  const found: Candidate[] = [];

  if (state.pending) {
    if (state.pending.player === player) found.push(...pendingCandidates(state, player, opts));
  } else if (state.cursor.current === player || opts.ignoreTurn) {
    const steps = turnSteps(currentPhase(state));
    let j = state.cursor.current === player ? state.cursor.step : 0;
    for (; j < steps.length; j++) {
      const step = steps[j] as TurnStepDef;
      for (const action of step.actions) {
        if (opts.only && !opts.only.includes(action.type)) continue;
        for (const move of actionMoves(state, player, action)) {
          found.push({ move, step: j, action });
        }
      }
      if (!step.optional) break;
    }
    if (j === steps.length && !opts.only) {
      found.push({ move: { player, type: 'endTurn' }, step: -1, action: null });
    }
  }

  if (
    !opts.skipLook &&
    !opts.only &&
    state.lookRequired &&
    !state.players[player]?.hasLookedAtHand
  ) {
    found.push({ move: { player, type: 'lookAtHand' }, step: -1, action: null });
  }
  // "Sort into melds" is free and always open, like looking at your hand.
  if (
    !opts.skipLook &&
    !opts.only &&
    autoArrangeAllowed(state) &&
    (state.zones[`hand@${player}`]?.length ?? 0) > 0
  ) {
    found.push({ move: { player, type: 'sortHand' }, step: -1, action: null });
  }

  // The same move can be allowed by more than one rule; the first rule wins. One rule
  // never offers the same move twice, so there's nothing to check then (passing offers
  // hundreds of moves, so this matters).
  if (new Set(found.flatMap((c) => (c.action ? [c.action] : []))).size <= 1) return found;
  const seen = new Set<string>();
  return found.filter((c) => {
    const key = moveKey(c.move);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pendingCandidates(
  state: GameState,
  player: PlayerId,
  opts: CandidateOptions,
): Candidate[] {
  const pending = state.pending;
  if (!pending) return [];
  if (pending.kind === 'ask') {
    if (opts.only) return [];
    return pending.values.map((value) => ({
      move: { player, type: 'choose', value },
      step: -1,
      action: null,
    }));
  }
  if (pending.kind === 'chooseSuit') {
    if (opts.only) return [];
    return SUITS.map((suit) => ({
      move: { player, type: 'chooseSuit', suit },
      step: -1,
      action: null,
    }));
  }
  // mayPlayDrawnCard: play the card just drawn (if a play rule allows it) or end the turn.
  const card = findCard(state, pending.card);
  const result: Candidate[] = [];
  for (const step of turnSteps(currentPhase(state))) {
    for (const action of step.actions) {
      if (action.type !== 'play' || (opts.only && !opts.only.includes('play'))) continue;
      if (card && allowsCard(state, player, action, card)) {
        result.push({
          move: { player, type: 'play', card: card.id, to: action.to },
          step: -1,
          action,
        });
      }
    }
  }
  if (!opts.only) result.push({ move: { player, type: 'endTurn' }, step: -1, action: null });
  return result;
}

/** One seat playing for another right now (a phase's `control`). */
export interface Control {
  /** The seat played for, which has no moves of its own meanwhile. */
  seat: PlayerId;
  /** The seat making its moves. */
  by: PlayerId;
}

/** Who plays for whom in the current phase, or null if nobody does. */
export function controlOf(state: GameState): Control | null {
  if (state.status !== 'inProgress') return null;
  const control = currentPhase(state).control;
  if (!control) return null;
  const scope = buildScope(state);
  const seat = evaluate(control.seat, scope);
  const by = evaluate(control.by, scope);
  if (seat === null || by === null) return null;
  for (const [what, value] of [
    ['seat', seat],
    ['by', by],
  ] as const) {
    if (typeof value !== 'number' || !state.players[value]) {
      throw new GameFileError(
        `control.${what} "${control[what]}" gave ${JSON.stringify(value)}; expected a seat`,
      );
    }
  }
  return seat === by ? null : { seat: seat as PlayerId, by: by as PlayerId };
}

/**
 * Candidates for a finished state, as the public API sees it: with a phase's
 * `control`, the seat played for has no moves and the seat playing for it
 * also gets its moves, marked with `by`.
 *
 * A state handed back by createGame or applyMove is never changed again, so
 * the answer is remembered: a client (or simulation) asks for the same
 * player's moves several times per move. Never use this while a move is being
 * applied.
 */
const settled = new WeakMap<GameState, Map<PlayerId, Candidate[]>>();
export function stableCandidates(
  state: GameState,
  player: PlayerId,
  opts: CandidateOptions = {},
): Candidate[] {
  let byPlayer = settled.get(state);
  if (!byPlayer) {
    byPlayer = new Map();
    settled.set(state, byPlayer);
  }
  let found = byPlayer.get(player);
  if (!found) {
    const control = controlOf(state);
    if (control?.seat === player) {
      found = [];
    } else {
      found = candidates(state, player);
      if (control?.by === player) {
        // Only the seat's turn: looking at or sorting its hand stays its own business.
        const theirs = candidates(state, control.seat, { skipLook: true }).map((c) => ({
          ...c,
          move: { ...c.move, by: player },
        }));
        found = [...found, ...theirs];
      }
    }
    byPlayer.set(player, found);
  }
  // The same list without the free moves (looking at or sorting your hand), worked out
  // from the full list rather than all over again.
  return opts.skipLook ? found.filter((c) => !FREE_MOVES.has(c.move.type)) : found;
}

/** Moves that never take a turn, left out with `skipLook`. */
export const FREE_MOVES: ReadonlySet<Move['type']> = new Set(['lookAtHand', 'sortHand']);

/**
 * Remembers the moves settle found for the player whose turn it is, once the
 * state stands still (it's about to be handed back by createGame or
 * applyMove), so getLegalMoves and playersToAct needn't work them out again.
 * Not in a phase with `control`, where a seat's public moves differ.
 */
export function rememberCandidates(state: GameState, player: PlayerId, found: Candidate[]): void {
  if (currentPhase(state).control) return;
  let byPlayer = settled.get(state);
  if (!byPlayer) {
    byPlayer = new Map();
    settled.set(state, byPlayer);
  }
  byPlayer.set(player, found);
}

export function getLegalMoves(state: GameState, player: PlayerId): Move[] {
  return stableCandidates(state, player).map((c) => c.move);
}

/** The legal candidate matching a requested move, or null if the move isn't legal. */
export function findCandidate(state: GameState, move: Move): Candidate | null {
  const found = stableCandidates(state, move.by ?? move.player);
  // Usually the very move getLegalMoves handed out: no need to compare keys.
  const same = found.find((c) => c.move === move);
  if (same) return same;
  return byKey(found).get(moveKey(move)) ?? null;
}

/**
 * Candidates by move key, worked out once per list: passing offers hundreds of
 * moves, and comparing each one's key for every move made adds up.
 */
const keyed = new WeakMap<Candidate[], Map<string, Candidate>>();
function byKey(found: Candidate[]): Map<string, Candidate> {
  let map = keyed.get(found);
  if (!map) {
    map = new Map();
    // The first candidate for a key wins, as in `candidates`.
    for (const c of found) {
      const key = moveKey(c.move);
      if (!map.has(key)) map.set(key, c);
    }
    keyed.set(found, map);
  }
  return map;
}

let checkingMoves = false;

/**
 * For `player.hasMove('pickUpPile')`: could this player make a move of this
 * type right now (turn order aside)? A move's own condition can't ask this.
 */
export function hasMove(state: GameState, player: PlayerId, type: string): boolean {
  if (!(ACTION_TYPES as readonly string[]).includes(type)) {
    throw new ExprError(`player.hasMove(): "${type}" isn't a kind of move`);
  }
  if (checkingMoves) throw new ExprError("A move's condition cannot itself use player.hasMove");
  checkingMoves = true;
  try {
    const only = [type as ActionDef['type']];
    return candidates(state, player, { only, ignoreTurn: true }).length > 0;
  } finally {
    checkingMoves = false;
  }
}

let checkingLegalPlay = false;

/** For `player.hasLegalPlay`: could this player play a card right now? */
export function hasLegalPlay(state: GameState, player: PlayerId): boolean {
  if (checkingLegalPlay) {
    throw new ExprError('A play condition cannot itself depend on player.hasLegalPlay');
  }
  checkingLegalPlay = true;
  try {
    return (
      candidates(state, player, { only: ['play', 'playToTrick'], ignoreTurn: true }).length > 0
    );
  } finally {
    checkingLegalPlay = false;
  }
}
