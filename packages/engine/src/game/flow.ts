/**
 * The phase and turn machine: whose turn it is, when turns, tricks, phases
 * and rounds end, and what happens next. All functions change a draft state
 * in place.
 */
import { applyAction } from '../actions';
import { allowsCard } from '../actions/common';
import { runEffects, setVar } from '../effects';
import { GameFileError, IllegalMoveError } from '../errors';
import { evaluateCondition } from '../expr/evaluate';
import { scoreRound } from '../scoring';
import { findCard } from './cards';
import { type Candidate, candidates, currentPhase, isTrickPhase, turnSteps } from './legal';
import type { Move, PlayerId } from './move';
import { buildScope } from './scope';
import { startRound } from './setup';
import {
  type AfterAction,
  type GameState,
  nextActive,
  type PlayerState,
  zoneCards,
  zoneInstances,
  zoneKey,
} from './state';

/** Moves allowed in one round before we decide the game file never ends a round. */
const MAX_MOVES_PER_ROUND = 10_000;
const MAX_ROUNDS = 10_000;

// ---- applying a move ----

export function performMove(state: GameState, candidate: Candidate, move: Move): void {
  const player = state.players[move.player] as PlayerState;
  state.log.push(move);
  if (++state.roundMoves > MAX_MOVES_PER_ROUND) {
    throw new GameFileError(`A round went on for more than ${MAX_MOVES_PER_ROUND} moves`);
  }
  if (move.type !== 'lookAtHand') state.cursor.passesInARow = 0;
  // Doing anything other than bidding means you've seen your hand.
  if (move.type !== 'bid' && move.type !== 'passBid') player.hasLookedAtHand = true;

  if (move.type === 'lookAtHand') return;

  if (move.type === 'chooseSuit') {
    const pending = state.pending;
    if (pending?.kind !== 'chooseSuit') throw new IllegalMoveError('Nothing to choose');
    state.pending = null;
    setVar(state, pending.target, move.suit);
    const card = pending.card === null ? undefined : (findCard(state, pending.card) ?? undefined);
    const ctx = card ? { player: move.player, card } : { player: move.player };
    if (!runEffects(state, pending.remaining, ctx, pending.after)) {
      finishAction(state, pending.after);
    }
    return;
  }

  if (move.type === 'endTurn') {
    state.pending = null;
    endTurn(state);
    return;
  }

  const action = candidate.action;
  if (!action) throw new IllegalMoveError(`Unexpected move "${move.type}"`);

  // Playing a just-drawn card resolves the draw and ends the turn.
  let after: AfterAction;
  if (state.pending?.kind === 'mayPlayDrawnCard') {
    state.pending = null;
    after = 'endTurn';
  } else {
    const steps = turnSteps(currentPhase(state));
    const step = steps[candidate.step];
    const next = step?.repeatable ? candidate.step : candidate.step + 1;
    after = next >= steps.length ? 'endTurn' : next;
  }

  const result = applyAction(state, move, action);
  const ctx = result.card ? { player: move.player, card: result.card } : { player: move.player };
  if (runEffects(state, action.effects ?? [], ctx, after)) return;

  if (action.type === 'draw' && action.then === 'mayPlayDrawnCard' && result.drawn?.length === 1) {
    const drawn = result.drawn[0];
    if (drawn && canPlayCard(state, move.player, drawn.id)) {
      state.pending = { kind: 'mayPlayDrawnCard', player: move.player, card: drawn.id };
      return;
    }
  }
  finishAction(state, after);
}

function canPlayCard(state: GameState, player: PlayerId, cardId: string): boolean {
  const card = findCard(state, cardId);
  if (!card) return false;
  return turnSteps(currentPhase(state)).some((step) =>
    step.actions.some((a) => a.type === 'play' && allowsCard(state, player, a, card)),
  );
}

function finishAction(state: GameState, after: AfterAction): void {
  if (after === 'endTurn') endTurn(state);
  else state.cursor.step = after;
}

// ---- turns ----

function endTurn(state: GameState): void {
  const cursor = state.cursor;
  cursor.turns[cursor.current] = (cursor.turns[cursor.current] ?? 0) + 1;
  cursor.step = 0;
  const phase = currentPhase(state);

  if (isTrickPhase(phase)) {
    const active = state.players.filter((p) => p.active).length;
    if (state.trick && state.trick.plays.length >= active) completeTrick(state);
    else cursor.current = nextActive(state, cursor.current, cursor.direction);
    return;
  }

  if (phase.rounds !== undefined) {
    const done = state.players.every(
      (p) => !p.active || (cursor.turns[p.id] ?? 0) >= (phase.rounds as number),
    );
    if (done) {
      endPhase(state);
      return;
    }
  }

  let next = nextActive(state, cursor.current, cursor.direction);
  while (cursor.skipNext > 0) {
    next = nextActive(state, next, cursor.direction);
    cursor.skipNext--;
  }
  cursor.current = next;
}

/**
 * Called after every move: ends phases whose `until` is met, skips players
 * who can't move, and stops when someone has a decision to make.
 */
export function settle(state: GameState): void {
  for (let guard = 0; ; guard++) {
    if (guard > MAX_MOVES_PER_ROUND) {
      throw new GameFileError('The game keeps skipping players without anyone able to move');
    }
    if (state.status === 'over' || state.pending) return;
    const phase = currentPhase(state);
    const cursor = state.cursor;

    if (shouldEndRound(state)) {
      endRound(state);
      continue;
    }
    if (
      phase.until &&
      evaluateCondition(phase.until, buildScope(state, { player: cursor.current }))
    ) {
      endPhase(state);
      continue;
    }
    if (candidates(state, cursor.current, { skipLook: true }).length > 0) return;

    // The current player has no legal move.
    if (isTrickPhase(phase)) {
      if (!state.trick || state.trick.plays.length === 0) {
        endPhase(state);
        continue;
      }
      throw new GameFileError(`Player ${cursor.current} has no card to play to the trick`);
    }
    cursor.passesInARow++;
    if (cursor.passesInARow >= state.players.filter((p) => p.active).length) {
      endPhase(state);
      continue;
    }
    endTurn(state);
  }
}

function shouldEndRound(state: GameState): boolean {
  const whenEmpty = currentPhase(state).whenEmpty ?? {};
  return Object.entries(whenEmpty).some(
    ([zone, policy]) =>
      policy === 'endRound' &&
      zoneInstances(state, zone).every((key) => zoneCards(state, key).length === 0),
  );
}

// ---- tricks ----

function trickZoneName(state: GameState): string {
  for (const step of turnSteps(currentPhase(state))) {
    for (const action of step.actions) {
      if (action.type === 'playToTrick') return action.to ?? 'trick';
    }
  }
  return 'trick';
}

function startTrick(state: GameState, leader: PlayerId): void {
  state.trick = {
    zone: zoneKey(state, trickZoneName(state), leader),
    leader,
    plays: [],
    winner: null,
  };
  state.cursor.current = leader;
}

function completeTrick(state: GameState): void {
  const phase = currentPhase(state);
  const trick = state.trick;
  if (!trick) return;
  if (runEffects(state, phase.afterTrick ?? [], {}, 'endTurn')) {
    throw new GameFileError('"choose" can\'t be used in afterTrick');
  }
  if (trick.winner === null) {
    throw new GameFileError('afterTrick must include a resolveTrick effect');
  }
  state.cursor.tricks++;
  state.lastTrick = trick;

  const leader = trick.winner;
  const handEmpty = zoneCards(state, zoneKey(state, 'hand', leader)).length === 0;
  if ((phase.repeat !== undefined && state.cursor.tricks >= phase.repeat) || handEmpty) {
    endPhase(state);
  } else {
    startTrick(state, leader);
  }
}

// ---- phases ----

export function enterPhase(state: GameState, index: number): void {
  const phases = state.file.phases;
  while (index < phases.length) {
    const phase = phases[index];
    if (phase && (!phase.if || evaluateCondition(phase.if, buildScope(state)))) break;
    index++;
  }
  if (index >= phases.length) {
    endRound(state);
    return;
  }
  const phase = phases[index] as (typeof phases)[number];
  const order = phase.leader?.first ?? phase.order ?? 'leftOfDealer';
  const direction: 1 | -1 = order === 'counterclockwise' ? -1 : 1;
  const dealerActive = state.players[state.dealer]?.active ?? false;
  const first =
    order === 'dealer' && dealerActive ? state.dealer : nextActive(state, state.dealer, direction);

  state.cursor = {
    phase: index,
    step: 0,
    current: first,
    direction,
    turns: state.players.map(() => 0),
    tricks: 0,
    passesInARow: 0,
    skipNext: 0,
  };
  state.trick = null;
  if (isTrickPhase(phase)) startTrick(state, first);
}

function endPhase(state: GameState): void {
  // Deliver passed cards.
  state.passing.forEach((cards, seat) => {
    if (cards.length > 0) zoneCards(state, zoneKey(state, 'hand', seat)).push(...cards);
  });
  state.passing = state.players.map(() => []);
  enterPhase(state, state.cursor.phase + 1);
}

// ---- rounds ----

function endRound(state: GameState): void {
  if (state.roundMoves === 0) {
    throw new GameFileError("A round ended without any moves; check the phases' end conditions");
  }
  const over = scoreRound(state);
  if (over) return;
  if (state.round >= MAX_ROUNDS) {
    throw new GameFileError(`The game didn't end after ${MAX_ROUNDS} rounds`);
  }
  state.round++;
  const rotation = state.file.setup.dealerRotation ?? 'left';
  if (rotation !== 'none') {
    state.dealer = nextActive(state, state.dealer, rotation === 'left' ? 1 : -1);
  } else if (!state.players[state.dealer]?.active) {
    state.dealer = nextActive(state, state.dealer, 1);
  }
  startRound(state);
}
