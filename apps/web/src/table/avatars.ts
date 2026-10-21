/**
 * Seat avatars and team colours. Each team has a colour (by team number, never
 * by game), and a player's avatar is their initials in their team's colour, so
 * partners share a colour and players on their own each get one.
 * See docs/decisions.md ("Table look").
 */
import type { TableInfo } from '@card-table/server/protocol';

/** How many team colours there are (`--team-0` … in styles.css); more teams reuse them. */
export const TEAM_COLOURS = 8;

/** The CSS colour for a team. */
export function teamColour(team: number): string {
  return `var(--team-${((team % TEAM_COLOURS) + TEAM_COLOURS) % TEAM_COLOURS})`;
}

/**
 * Up to two letters for a name: "Raj Patel" → "RP", "Ana" → "A". Numbered names
 * keep their number, so "Bot 3" → "B3" and "Seat 2" → "S2".
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letter = (word: string) => (Array.from(word)[0] ?? '').toUpperCase();
  if (last && /^\d+$/.test(last)) return letter(first) + last;
  return letter(first) + (last ? letter(last) : '');
}

/** Initials for each seat, from the player's real name (not "You"). */
export type SeatInitials = (seat: number) => string;

export function seatInitials(table: TableInfo | null): SeatInitials {
  return (seat) =>
    initials(table?.seats.find((s) => s.seat === seat)?.user?.displayName ?? `Seat ${seat + 1}`);
}
