/**
 * A finished round played back move by move with every card face up, for
 * "Show all hands". Only a round that's over can be played back, so this never
 * shows a card of the round in play.
 */
import { applyMove, createGame, dealNextRound, isBetweenRounds } from './api';
import type { Move, PlayerId } from './game/move';
import type { GameState } from './game/state';
import type { GameFile, OptionValue } from './game/types';
import { type OpenView, openView, trickZones } from './view';

export interface RoundReplay {
  round: number;
  dealer: PlayerId;
  /** Zones tricks are played into, to draw as the trick rather than as piles. */
  trickZones: string[];
  /** The round's moves, oldest first, with every card shown. */
  moves: Move[];
  /** The table just after the deal, then after each move: `frames[i + 1]` follows `moves[i]`. */
  frames: OpenView[];
}

/**
 * Plays the game back from its seed and saved moves to round `round`, and returns
 * that round. Null if the round hasn't finished (or never started).
 */
export function replayRound(
  file: GameFile,
  options: Record<string, OptionValue>,
  playerCount: number,
  seed: string,
  moves: readonly Move[],
  round: number,
): RoundReplay | null {
  let state: GameState = createGame(file, options, playerCount, seed);
  let next = 0;
  // Holding each next deal, as the server plays, so the round's last frame is its end.
  const play = (): boolean => {
    if (isBetweenRounds(state)) {
      state = dealNextRound(state);
      return true;
    }
    const move = moves[next];
    if (!move || state.status === 'over') return false;
    next++;
    state = applyMove(state, move, { holdNextRound: true });
    return true;
  };

  while (state.round < round || isBetweenRounds(state)) if (!play()) return null;
  if (state.round !== round) return null;

  const dealer = state.dealer;
  const frames = [openView(state)];
  const played: Move[] = [];
  const over = () => state.history.some((r) => r.round === round);
  while (!over()) {
    const move = moves[next];
    if (!move || isBetweenRounds(state)) return null;
    play();
    played.push(move);
    frames.push(openView(state));
  }
  return { round, dealer, trickZones: trickZones(state), moves: played, frames };
}
