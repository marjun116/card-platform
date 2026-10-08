import { SUITS } from '../cards/card';
import { ExprError } from '../errors';
import { actionMoves, allowsCard } from '../actions';
import { type Move, moveKey, type PlayerId } from './move';
import { findCard } from './cards';
import { autoArrangeAllowed } from './arrangement';
import type { GameState } from './state';
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
  if (state.status === 'over' || !state.players[player]?.active) return [];
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

/**
 * Candidates for a finished state, as the public API sees it. A state handed
 * back by createGame or applyMove is never changed again, so the answer is
 * remembered: a client (or simulation) asks for the same player's moves
 * several times per move. Never use this while a move is being applied.
 */
const settled = new WeakMap<GameState, Map<string, Candidate[]>>();
export function stableCandidates(
  state: GameState,
  player: PlayerId,
  opts: CandidateOptions = {},
): Candidate[] {
  let byKey = settled.get(state);
  if (!byKey) {
    byKey = new Map();
    settled.set(state, byKey);
  }
  const key = `${player}|${opts.skipLook ? 'skipLook' : ''}`;
  let found = byKey.get(key);
  if (!found) {
    found = candidates(state, player, opts);
    byKey.set(key, found);
  }
  return found;
}

export function getLegalMoves(state: GameState, player: PlayerId): Move[] {
  return stableCandidates(state, player).map((c) => c.move);
}

/** The legal candidate matching a requested move, or null if the move isn't legal. */
export function findCandidate(state: GameState, move: Move): Candidate | null {
  const key = moveKey(move);
  return stableCandidates(state, move.player).find((c) => moveKey(c.move) === key) ?? null;
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
