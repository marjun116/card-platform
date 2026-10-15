/**
 * The phase and turn machine: whose turn it is, when turns, tricks, phases
 * and rounds end, and what happens next. All functions change a draft state
 * in place.
 */
import { applyAction } from '../actions';
import { allowsCard } from '../actions/common';
import { runEffects, setVar } from '../effects';
import { GameFileError, IllegalMoveError } from '../errors';
import { evaluate, evaluateCondition } from '../expr/evaluate';
import { DEALER_ROTATIONS, LEADER_FIRST } from '../schema/gameFile';
import { scoreRound } from '../scoring';
import { findCard } from './cards';
import {
  type Candidate,
  candidates,
  currentPhase,
  FREE_MOVES,
  isTrickPhase,
  rememberCandidates,
  turnSteps,
} from './legal';
import type { Move, PlayerId } from './move';
import type { PhaseDef } from './types';
import { buildScope } from './scope';
import { resolveSetting } from './settings';
import { endsRoundWhenEmpty } from './zones';
import { arrange, sortHand } from './arrangement';
import { startRound } from './setup';
import {
  type AfterAction,
  type GameState,
  isPlaying,
  nextActive,
  type PlayerState,
  playingCount,
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
  // Arranging your hand is free: it doesn't take a turn or count towards the round's moves.
  if (move.type === 'arrange') {
    arrange(state, move.player, move.groups);
    return;
  }
  if (move.type === 'sortHand') {
    sortHand(state, move.player);
    return;
  }
  if (++state.roundMoves > MAX_MOVES_PER_ROUND) {
    throw new GameFileError(`A round went on for more than ${MAX_MOVES_PER_ROUND} moves`);
  }
  if (move.type !== 'lookAtHand') state.cursor.passesInARow = 0;
  // Doing anything other than bidding means you've seen your hand.
  if (move.type !== 'bid' && move.type !== 'passBid') player.hasLookedAtHand = true;

  if (move.type === 'lookAtHand') return;

  // Answering another player's question: the asker's turn then goes on.
  if (move.type === 'choose' && state.pending?.kind === 'ask') {
    const pending = state.pending;
    state.pending = null;
    setVar(state, pending.target, move.value);
    const card = pending.card === null ? undefined : (findCard(state, pending.card) ?? undefined);
    const ctx = card ? { player: pending.asker, card } : { player: pending.asker };
    if (!runEffects(state, pending.remaining, ctx, pending.after)) {
      finishAction(state, pending.after);
    }
    return;
  }

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
  const ctx = {
    player: move.player,
    ...(result.card ? { card: result.card } : {}),
    ...(result.meld ? { meld: result.meld } : {}),
  };
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
  cursor.draws = 0;
  const phase = currentPhase(state);

  if (isTrickPhase(phase)) {
    if (state.trick && state.trick.plays.length >= playingCount(state)) completeTrick(state);
    else cursor.current = nextActive(state, cursor.current, cursor.direction);
    return;
  }

  if (phase.rounds !== undefined) {
    const done = state.players.every(
      (p) => !isPlaying(p) || (cursor.turns[p.id] ?? 0) >= (phase.rounds as number),
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
    if (state.status !== 'inProgress' || state.pending) return;
    const phase = currentPhase(state);
    const cursor = state.cursor;

    // A pile that has run out for good ends this phase; later phases (such as
    // players showing their hands) still happen before the round is scored.
    if (shouldEndRound(state)) {
      endPhase(state);
      continue;
    }
    if (
      phase.until &&
      evaluateCondition(phase.until, buildScope(state, { player: cursor.current }))
    ) {
      endPhase(state);
      continue;
    }
    const all = candidates(state, cursor.current);
    const options = all.filter((c) => !FREE_MOVES.has(c.move.type));
    // Nothing left to do but end the turn (say an optional knock that isn't possible):
    // the turn ends by itself. It counts as a pass, so a table where nobody can do
    // anything still ends the phase.
    if (options.length === 1 && options[0]?.move.type === 'endTurn') {
      cursor.passesInARow++;
      if (cursor.passesInARow >= playingCount(state)) {
        endPhase(state);
        continue;
      }
      endTurn(state);
      continue;
    }
    if (options.length > 0) {
      // The game stands still now: keep these moves so nobody works them out again.
      rememberCandidates(state, cursor.current, all);
      return;
    }

    // The current player has no legal move.
    if (isTrickPhase(phase)) {
      if (!state.trick || state.trick.plays.length === 0) {
        endPhase(state);
        continue;
      }
      throw new GameFileError(`Player ${cursor.current} has no card to play to the trick`);
    }
    cursor.passesInARow++;
    if (cursor.passesInARow >= playingCount(state)) {
      endPhase(state);
      continue;
    }
    endTurn(state);
  }
}

/**
 * A pile that has run out for good ("endRound", or no reshuffles left) ends
 * the round, but only at the start of a turn: a player who just drew the last
 * card still gets to finish their turn.
 */
function shouldEndRound(state: GameState): boolean {
  if (state.cursor.step !== 0) return false;
  const whenEmpty = currentPhase(state).whenEmpty ?? {};
  return Object.keys(whenEmpty).some((zone) =>
    zoneInstances(state, zone).every((key) => endsRoundWhenEmpty(state, key)),
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
    number: state.cursor.tricks + 1,
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
    // The finished trick stays visible as lastTrick; there is no current trick.
    state.trick = null;
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
  const order = startingOrder(state, phase);
  const direction: 1 | -1 = order === 'counterclockwise' ? -1 : 1;
  const dealerActive = isPlaying(state.players[state.dealer]);
  const first =
    typeof order === 'number'
      ? order
      : order === 'dealer' && dealerActive
        ? state.dealer
        : nextActive(state, state.dealer, direction);

  state.cursor = {
    phase: index,
    step: 0,
    current: first,
    direction,
    turns: state.players.map(() => 0),
    tricks: 0,
    passesInARow: 0,
    skipNext: 0,
    draws: 0,
  };
  state.trick = null;
  if (isTrickPhase(phase)) startTrick(state, first);
  // The validator only allows effects here that finish straight away (no choices or points).
  if (phase.start) runEffects(state, phase.start, { player: first }, 'endTurn');
}

/**
 * Who starts the phase: `leader.first` if given (a name, or an expression
 * giving a name or a seat, such as holderOf('2C'); null means left of the
 * dealer), otherwise the phase's `order`.
 */
function startingOrder(
  state: GameState,
  phase: PhaseDef,
): NonNullable<PhaseDef['order']> | PlayerId {
  const setting = phase.leader?.first;
  if (setting === undefined) return phase.order ?? 'leftOfDealer';
  if ((LEADER_FIRST as readonly string[]).includes(setting)) {
    return setting as (typeof LEADER_FIRST)[number];
  }
  const value = evaluate(setting, buildScope(state));
  if (value === null) return 'leftOfDealer';
  if (typeof value === 'number' && isPlaying(state.players[value])) return value;
  if (typeof value === 'string' && (LEADER_FIRST as readonly string[]).includes(value)) {
    return value as (typeof LEADER_FIRST)[number];
  }
  throw new GameFileError(
    `leader.first "${setting}" gave ${JSON.stringify(value)}; expected an active seat, ` +
      `${LEADER_FIRST.join(' or ')}`,
  );
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
  // Everyone is back for the next round (the deal passes over nobody who sat out).
  for (const player of state.players) player.sittingOut = false;
  if (over) return;
  // The round's cards stay where they are until the next deal (see dealNextRound).
  state.status = 'betweenRounds';
}

/**
 * Deals the next round of a game that is between rounds, and plays on until
 * someone has a decision to make.
 */
export function dealNextRound(state: GameState): void {
  if (state.round >= MAX_ROUNDS) {
    throw new GameFileError(`The game didn't end after ${MAX_ROUNDS} rounds`);
  }
  // Worked out before the next deal clears the round's values (a passed-out hand: "none").
  const rotation = resolveSetting(
    state,
    state.file.setup.dealerRotation ?? 'left',
    DEALER_ROTATIONS,
    'dealerRotation',
  );
  state.round++;
  if (rotation !== 'none') {
    state.dealer = nextActive(state, state.dealer, rotation === 'left' ? 1 : -1);
  } else if (!state.players[state.dealer]?.active) {
    state.dealer = nextActive(state, state.dealer, 1);
  }
  state.status = 'inProgress';
  startRound(state);
  settle(state);
}
