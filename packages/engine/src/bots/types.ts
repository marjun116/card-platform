/**
 * Bots: computer players for built-in games. A bot sees exactly what a person
 * in its seat would (its `viewFor` view and its legal moves), never the full
 * game state, and picks one of the legal moves.
 */
import type { Move } from '../game/move';
import type { GameFile } from '../game/types';
import type { PlayerView } from '../view';

export interface BotInput {
  /** The game's rules. Public: every player can read them. */
  file: GameFile;
  /** What the bot's seat can see. */
  view: PlayerView;
  /** The bot's legal moves right now (never empty). */
  legal: readonly Move[];
  /** A seeded random number from 0 to n-1, so a bot's choices can be replayed. */
  random: (n: number) => number;
}

/** Picks one of the legal moves. */
export type Bot = (input: BotInput) => Move;

/** A part of a bot that handles some decisions and leaves the rest (null) to others. */
export type BotPart = (input: BotInput) => Move | null;

/** Tries each part in turn; the first answer wins, and random play covers the rest. */
export function combineBots(...parts: BotPart[]): Bot {
  return (input) => {
    for (const part of parts) {
      const move = part(input);
      if (move) return move;
    }
    return randomMove(input);
  };
}

/** Any legal move except looking at your hand (bots always look first; see lookFirst). */
export function randomMove({ legal, random }: BotInput): Move {
  const real = legal.filter((m) => m.type !== 'lookAtHand' && m.type !== 'sortHand');
  const pool = real.length > 0 ? real : legal;
  return pool[random(pool.length)] as Move;
}

/** Any legal move, uniformly at random: the simplest bot, used in tests. */
export const randomBot: Bot = randomMove;
