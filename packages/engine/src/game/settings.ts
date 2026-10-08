/**
 * Settings with a fixed list of values (pass direction, who leads first, how
 * ties end) can also be written as an expression giving one of those values,
 * so a house rule can change them: "direction": "options.passing".
 */
import { GameFileError } from '../errors';
import { evaluate } from '../expr/evaluate';
import { buildScope } from './scope';
import type { GameState } from './state';

/** The setting's value: itself if it's one of `allowed`, otherwise the expression's result. */
export function resolveSetting<T extends string>(
  state: GameState,
  setting: string,
  allowed: readonly T[],
  what: string,
): T {
  if ((allowed as readonly string[]).includes(setting)) return setting as T;
  const value = evaluate(setting, buildScope(state));
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new GameFileError(
    `${what} "${setting}" gave ${JSON.stringify(value)}; expected one of ${allowed.join(', ')}`,
  );
}
