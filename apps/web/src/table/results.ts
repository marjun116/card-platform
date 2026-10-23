/**
 * What the results page says about a finished game, worked out from its rounds:
 * the teams in finishing order, each player's tricks and bids made, and the
 * biggest round. Generic: it reads the results, never the game's name.
 */
import type { PlayerView, RoundResult } from '@card-table/engine';

type Team = PlayerView['teams'][number];

export interface Placed {
  team: Team;
  /** 1 for the winners; level teams share a place. */
  place: number;
}

/**
 * The teams in finishing order: the winners first, then by score (lowest first
 * where the lowest score wins).
 */
export function finishingOrder(
  teams: readonly Team[],
  winners: readonly number[],
  winner: PlayerView['goal']['winner'],
): Placed[] {
  const won = (team: Team) => team.players.some((p) => winners.includes(p));
  // Negative when `a` finished ahead of `b`.
  const ahead = (a: Team, b: Team) =>
    Number(won(b)) - Number(won(a)) ||
    (winner === 'lowestScore' ? a.score - b.score : b.score - a.score);
  const sorted = [...teams].sort(ahead);
  return sorted.map((team) => ({
    team,
    place: 1 + sorted.filter((other) => ahead(other, team) < 0).length,
  }));
}

/** "1st", "2nd", "3rd", "4th" … */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

export interface PlayerStats {
  id: number;
  /** Tricks won over the whole game. */
  tricks: number;
  /** Rounds the player bid in where their team had a contract, and how many it made. */
  bids: { made: number; of: number };
}

export interface GameStats {
  players: PlayerStats[];
  /** The game has tricks (someone won one). */
  showTricks: boolean;
  /** The game has bids against a contract (someone bid in a round with one). */
  showBids: boolean;
  /** The most points one team scored in one round (the earliest, if level), if any scored. */
  biggest: { round: number; team: number; points: number } | null;
}

/**
 * The game's stats from its rounds. A bid counts only in rounds where the
 * player's team had a contract, so in bridge a defender's bids don't count
 * against the contract the other side won.
 */
export function gameStats(
  history: readonly RoundResult[],
  players: readonly { id: number; team: number }[],
): GameStats {
  const stats = players.map((player) => {
    let tricks = 0;
    const bids = { made: 0, of: 0 };
    for (const round of history) {
      const mine = round.players.find((p) => p.id === player.id);
      if (!mine) continue;
      tricks += mine.tricks;
      const made = round.teams.find((t) => t.id === player.team)?.made ?? null;
      if (mine.bid === null || made === null) continue;
      bids.of++;
      if (made) bids.made++;
    }
    return { id: player.id, tricks, bids };
  });

  let biggest: GameStats['biggest'] = null;
  for (const round of history) {
    for (const team of round.teams) {
      if (team.points > (biggest?.points ?? 0)) {
        biggest = { round: round.round, team: team.id, points: team.points };
      }
    }
  }

  return {
    players: stats,
    showTricks: stats.some((p) => p.tricks > 0),
    showBids: stats.some((p) => p.bids.of > 0),
    biggest,
  };
}
