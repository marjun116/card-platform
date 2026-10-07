import type { GameSummary } from '@card-table/server/protocol';

/** "2–6 players" or "4 players, 2 teams". */
export function playersText(game: GameSummary): string {
  const counts = game.players;
  const range = counts.length === 1 ? `${counts[0]}` : `${counts[0]}–${counts[counts.length - 1]}`;
  const teams = game.teams ? `, ${game.teams.length} teams` : '';
  return `${range} players${teams}`;
}
