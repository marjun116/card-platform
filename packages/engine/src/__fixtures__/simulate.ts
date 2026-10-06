/**
 * Plays a game to the end with randomly chosen legal moves (seeded, so
 * failures can be reproduced), checking invariants after every move.
 */
import { applyMove, createGame, getLegalMoves, playersToAct } from '../api';
import type { Move } from '../game/move';
import type { GameState } from '../game/state';
import type { GameFile, OptionValue } from '../game/types';
import { randomInt, seedRng } from '../rng';

export interface SimulationResult {
  state: GameState;
  moves: Move[];
}

export interface SimulationOptions {
  options?: Record<string, OptionValue>;
  maxMoves?: number;
  /** Picks a move; defaults to uniform random. */
  choose?: (moves: Move[], pick: (n: number) => number) => Move;
}

export function totalCards(state: GameState): number {
  return (
    Object.values(state.zones).reduce((n, cards) => n + cards.length, 0) +
    Object.values(state.melds).reduce((n, melds) => n + melds.flat().length, 0) +
    state.passing.reduce((n, cards) => n + cards.length, 0)
  );
}

export function simulate(
  file: GameFile,
  playerCount: number,
  seed: string,
  { options = {}, maxMoves = 20_000, choose }: SimulationOptions = {},
): SimulationResult {
  const rng = seedRng(`moves:${seed}`);
  const pick = (n: number) => randomInt(rng, n);
  let state = createGame(file, options, playerCount, seed);
  const deckSize = totalCards(state);
  const moves: Move[] = [];

  while (state.status !== 'over') {
    if (moves.length >= maxMoves)
      throw new Error(`Game ${seed} didn't finish in ${maxMoves} moves`);
    const actors = playersToAct(state);
    if (actors.length !== 1) {
      throw new Error(`Expected exactly one player to act, got [${actors.join(', ')}]`);
    }
    const legal = getLegalMoves(state, actors[0] as number).filter((m) => m.type !== 'lookAtHand');
    if (legal.length === 0) throw new Error('A player to act has no legal moves');
    const move = choose ? choose(legal, pick) : (legal[pick(legal.length)] as Move);
    state = applyMove(state, move);
    moves.push(move);
    if (totalCards(state) !== deckSize) {
      throw new Error(`Cards appeared or vanished after move ${moves.length}`);
    }
  }
  return { state, moves };
}
