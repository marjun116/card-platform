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

/** Final scores, winners first: "You & Bot 2 520 · Ann & Bea 310". */
export function finalScoresText(game: PastGame): string {
  if (!game.teams) return '';
  const name = (seat: number) =>
    seat === game.you
      ? 'You'
      : (game.seats.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat + 1}`);
  const won = (players: number[]) => players.some((p) => game.winners.includes(p));
  return [...game.teams]
    .sort((a, b) => Number(won(b.players)) - Number(won(a.players)))
    .map((t) => `${t.players.map(name).join(' & ')} ${t.score}`)
    .join(' · ');
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
