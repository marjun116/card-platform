import type { GameSummary } from '@card-table/server/protocol';
import { api } from './api';
import { type Loaded, useLoad } from './useLoad';

/** Everything the rules pop-up shows: the game's written rules and its house-rule options. */
export interface Rulebook {
  rules: Loaded<string>;
  games: Loaded<GameSummary[]>;
}

/**
 * Loads a table's rulebook as soon as the table is on screen, so the rules
 * pop-up can open complete instead of growing as its parts arrive.
 */
export function useRulebook(slug: string): Rulebook {
  const rules = useLoad(() => api.rules(slug), `rules:${slug}`);
  const games = useLoad(api.games, 'games');
  return { rules, games };
}

/** True once every part of the rulebook has arrived (or failed), so the pop-up can open. */
export function rulebookReady(book: Rulebook): boolean {
  return book.rules.state !== 'loading' && book.games.state !== 'loading';
}
