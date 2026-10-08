import type { GameSummary } from '@card-table/server/protocol';

/** "2–6 players", "4 players, 2 teams" or "2–4 players, partners with 4". */
export function playersText(game: GameSummary): string {
  const counts = game.players;
  const range = counts.length === 1 ? `${counts[0]}` : `${counts[0]}–${counts[counts.length - 1]}`;
  const teams = game.teams
    ? `, ${game.teams.length} teams`
    : game.partnersWith.length > 0
      ? `, partners with ${game.partnersWith.join(' or ')}`
      : '';
  return `${range} players${teams}`;
}
