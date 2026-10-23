/**
 * What the round summary says, worked out from a finished round's result:
 * where the points came from, each team's bid, who's leading, and one or two
 * highlights. Generic: it reads the result and the game file's labels, never
 * the game's name.
 */
import type { MomentEvent, PlayerView, RoundResult } from '@card-table/engine';
import { type BidLabels, momentText, type SeatNames, teamName } from './describe';
import { humanize } from './zones';

type TeamResult = RoundResult['teams'][number];
type Team = { id: number; players: number[] };

/** Words for tracked counters (`view.trackLabels`); null hides a counter. */
export type TrackLabels = Record<string, string | null>;

export function tracksText(tracks: Record<string, number>, labels: TrackLabels = {}): string {
  return Object.entries(tracks)
    .filter(([name]) => labels[name] !== null)
    .map(([name, value]) => `${labels[name] ?? humanize(name)} ${value}`)
    .join(' · ');
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** "Tricks +60 · Bags +2 · Nil +100", or null when the game labels none of its points. */
export function partsText(parts: TeamResult['parts']): string | null {
  if (!parts.some((p) => p.label !== null)) return null;
  return parts.map((p) => `${p.label ?? 'Other'} ${signed(p.points)}`).join(' · ');
}

/**
 * A team's bid as a number of tricks: its players' number bids added up (nil
 * counts as 0), as the engine's `team.bid`. Null if nobody bid a number, or if
 * a bid has words of its own (bridge's "1♣" is a number underneath, not tricks).
 */
export function teamBid(
  result: RoundResult,
  members: readonly number[],
  labels: BidLabels = {},
): number | null {
  const bids = result.players.filter((p) => members.includes(p.id)).map((p) => p.bid);
  if (!bids.some((bid) => typeof bid === 'number')) return null;
  if (bids.some((bid) => typeof bid === 'number' && Object.hasOwn(labels, String(bid)))) {
    return null;
  }
  return bids.reduce<number>((sum, bid) => sum + (typeof bid === 'number' ? bid : 0), 0);
}

/**
 * The teams in the lead: the highest score, or the lowest where the lowest wins.
 * None while every team is level, or where the game isn't won on score.
 */
export function leaders(
  teams: readonly { id: number; score: number }[],
  winner: PlayerView['goal']['winner'],
): number[] {
  if (winner === 'lastActivePlayer' || teams.length < 2) return [];
  const scores = teams.map((t) => t.score);
  const best = winner === 'lowestScore' ? Math.min(...scores) : Math.max(...scores);
  const top = teams.filter((t) => t.score === best);
  return top.length === teams.length ? [] : top.map((t) => t.id);
}

/** How far a score is toward the target, from 0 to 1. */
export function progress(score: number, target: number): number {
  return target > 0 ? Math.min(1, Math.max(0, score / target)) : 0;
}

/**
 * One or two things worth saying about the round: its big moments first ("Ana:
 * Nil broken"), then whoever took the most tricks, then the team that scored the most.
 */
export function highlights(
  result: RoundResult,
  moments: readonly MomentEvent[],
  teams: readonly Team[],
  names: SeatNames,
): string[] {
  const found = new Set(
    moments.filter((m) => m.round === result.round).map((m) => momentText(m, { teams }, names)),
  );

  const most = Math.max(0, ...result.players.map((p) => p.tricks));
  const topTakers = result.players.filter((p) => p.tricks === most);
  if (most > 0 && topTakers.length === 1 && topTakers[0]) {
    found.add(`${names(topTakers[0].id)} took ${most} trick${most === 1 ? '' : 's'}`);
  }

  const best = Math.max(...result.teams.map((t) => t.points));
  const topScorers = result.teams.filter((t) => t.points === best);
  const team = topScorers.length === 1 ? teams.find((t) => t.id === topScorers[0]?.id) : undefined;
  if (best > 0 && team && result.teams.length > 1) {
    found.add(`${teamName(team, names)} scored ${best}`);
  }
  return [...found].slice(0, 2);
}
