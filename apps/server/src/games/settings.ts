/**
 * A table's settings: the game, its house rules (options) and the number of
 * players. Tables and saved variants check them the same way.
 */
import {
  createGame,
  type GameFile,
  IllegalMoveError,
  type OptionValue,
  SetupError,
} from '@card-table/engine';
import type { GameVersion } from '../store/types';
import { type GameCatalog, playerCounts } from './catalog';

export interface Settings {
  game: GameVersion;
  /** Every option the game has, defaults filled in. */
  options: Record<string, OptionValue>;
  playerCount: number;
}

/** Why settings were refused, as an HTTP status and a message safe to show. */
export interface SettingsError {
  status: number;
  error: string;
}

/** Checks settings sent by a client. A missing player count means the smallest allowed. */
export function checkSettings(
  catalog: GameCatalog,
  slug: string,
  options: Record<string, OptionValue> | undefined,
  playerCount: number | undefined,
): Settings | SettingsError {
  // Built-in games only for now; custom games (signed-in creators only) come in Phase 6.
  const game = catalog.builtIn(slug);
  if (!game) return { status: 404, error: `There is no game "${slug}"` };
  const counts = playerCounts(game.file);
  const count = playerCount ?? counts[0] ?? 0;
  if (!counts.includes(count)) {
    return { status: 400, error: `${game.name} is for ${counts.join(', ')} players` };
  }
  // Dealing a throwaway game checks the options and fills in defaults.
  try {
    return {
      game,
      options: createGame(game.file, options ?? {}, count, 'check').options,
      playerCount: count,
    };
  } catch (error) {
    if (error instanceof SetupError || error instanceof IllegalMoveError) {
      return { status: 400, error: error.message };
    }
    throw error;
  }
}

/**
 * Saved options made to fit a game file that may have changed since they were
 * saved: options the game no longer has are dropped, and a value that's no
 * longer allowed goes back to the default. The player count does the same.
 */
export function fitSettings(
  file: GameFile,
  options: Record<string, OptionValue>,
  playerCount: number,
): { options: Record<string, OptionValue>; playerCount: number } {
  const fitted: Record<string, OptionValue> = {};
  for (const [name, def] of Object.entries(file.options ?? {})) {
    const value = Object.hasOwn(options, name) ? options[name] : undefined;
    const allowed =
      def.type === 'boolean'
        ? typeof value === 'boolean'
        : value !== undefined && (def.values ?? []).includes(value);
    fitted[name] = allowed ? (value as OptionValue) : def.default;
  }
  const counts = playerCounts(file);
  return {
    options: fitted,
    playerCount: counts.includes(playerCount) ? playerCount : (counts[0] ?? playerCount),
  };
}
