/** Building what a bot is given: its view, its legal moves and nothing more. */
import { draft, type GameState } from '../game/state';
import { sortHand } from '../game/arrangement';
import type { Move, PlayerId } from '../game/move';
import { viewFor } from '../view';
import type { Bot, BotInput } from './types';

/** The input for the bot in `seat`, from the real game state. */
export function botInput(
  state: GameState,
  seat: PlayerId,
  legal: readonly Move[],
  random: (n: number) => number,
): BotInput {
  return {
    file: state.file,
    view: viewFor(state, seat),
    legal,
    random,
    sortedGroups: () => {
      if (!state.file.meldRules) return null;
      const next = draft(state);
      sortHand(next, seat);
      return next.players[seat]?.groups ?? [];
    },
  };
}

/** The seat a bot is choosing for: the one whose turn it is, or the seat controlling it. */
export function botSeat(legal: readonly Move[], fallback: PlayerId): PlayerId {
  const move = legal[0];
  return move?.by ?? move?.player ?? fallback;
}

/** Asks `bot` for the move of the seat that has these legal moves. */
export function askBot(
  bot: Bot,
  state: GameState,
  legal: readonly Move[],
  random: (n: number) => number,
): Move {
  return bot(botInput(state, botSeat(legal, state.cursor.current), legal, random));
}
