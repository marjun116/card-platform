import type { OptionDef, OptionValue } from '@card-table/engine';
import type { GameStats, GameSummary, PastGame } from '@card-table/server/protocol';

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

/** "About 20 min" or "30–60 min", or null if the game doesn't say. */
export function minutesText(game: Pick<GameSummary, 'minutes'>): string | null {
  if (!game.minutes) return null;
  const [low, high] = game.minutes;
  return low === high ? `About ${low} min` : `${low}–${high} min`;
}

/** "You won", "You lost", "You shared the win" or "Ended early". */
export function outcomeText(game: PastGame): string {
  if (game.status === 'abandoned') return 'Ended early';
  if (!game.winners.includes(game.you)) return 'You lost';
  // Partners win together; anyone else sharing the win is a tie.
  const partners = game.teams?.find((t) => t.players.includes(game.you))?.players ?? [game.you];
  return game.winners.every((seat) => partners.includes(seat)) ? 'You won' : 'You shared the win';
}

/** A seat's player in a past game: "You", their name, or "Seat 4" if no one holds it now. */
export function pastName(game: PastGame, seat: number): string {
  if (seat === game.you) return 'You';
  return game.seats.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat + 1}`;
}

export type PastTeam = NonNullable<PastGame['teams']>[number] & { won: boolean };

/**
 * The final scores in finishing order, as on the results page: the winners first,
 * then by score (lowest first where the lowest score wins). Empty if it ended early.
 */
export function pastStandings(game: PastGame): PastTeam[] {
  const teams = (game.teams ?? []).map((t) => ({
    ...t,
    won: t.players.some((p) => game.winners.includes(p)),
  }));
  return teams.sort(
    (a, b) =>
      Number(b.won) - Number(a.won) || (game.lowestWins ? a.score - b.score : b.score - a.score),
  );
}

/** "Ana", "Ana and Raj", "Ana, Raj and Sam". */
export function nameList(all: string[]): string {
  return all.length > 1
    ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`
    : (all[0] ?? '');
}

export const DATE_GROUPS = ['Today', 'This week', 'Earlier this month', 'Older'] as const;
export type DateGroup = (typeof DATE_GROUPS)[number];

/**
 * Where a past game goes in the list, by when it ended, in local time. Weeks start
 * on Monday; a game from this week but last month is "This week".
 */
export function dateGroup(endedAt: string | null, now: Date): DateGroup {
  if (endedAt === null) return 'Older';
  const ended = new Date(endedAt).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  if (ended >= today.getTime()) return 'Today';
  if (ended >= monday.getTime()) return 'This week';
  if (ended >= month.getTime()) return 'Earlier this month';
  return 'Older';
}

/** "Spades: 3 played, 1 won". */
export function statsText(stats: GameStats): string {
  return `${stats.game.name}: ${stats.played} played, ${stats.won} won`;
}

/** A house rule's value as the lobby shows it: its label, or On/Off, or the value. */
export function optionText(value: OptionValue, def: OptionDef | undefined): string {
  const label = def?.labels?.[String(value)];
  if (label) return label;
  if (value === true) return 'On';
  if (value === false) return 'Off';
  return String(value);
}
