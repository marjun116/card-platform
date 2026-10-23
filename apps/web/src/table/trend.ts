/** Where the score trend chart draws everything (see ScoreTrend). */
import type { RoundResult } from '@card-table/engine';

export const WIDTH = 320;
export const HEIGHT = 120;
/** Room for the score labels on the left and the round numbers below. */
export const LEFT = 34;
export const BOTTOM = 16;
export const TOP = 6;
export const RIGHT = 6;

export interface Trend {
  /** Each team's line, as SVG points from the start of the game to the last round. */
  lines: { team: number; points: [number, number][] }[];
  /** The lowest and highest score drawn, and where the target's line is (if any). */
  low: number;
  high: number;
  targetY: number | null;
  /** The x of each round, with its number. */
  rounds: { round: number; x: number }[];
  /** The y of 0, where scores can go below it. */
  zeroY: number | null;
}

/** Where everything goes, from the history. Scores start from where the first round began. */
export function trend(history: readonly RoundResult[], target: number | null): Trend {
  const first = history[0];
  const starts = first?.teams.map((t) => ({ team: t.id, score: t.score - t.points })) ?? [];
  const scores = [
    ...starts.map((s) => s.score),
    ...history.flatMap((r) => r.teams.map((t) => t.score)),
    ...(target === null ? [] : [target]),
  ];
  const low = Math.min(0, ...scores);
  const high = Math.max(low + 1, ...scores);
  const x = (i: number) => LEFT + ((WIDTH - LEFT - RIGHT) * i) / Math.max(1, history.length);
  const y = (score: number) => TOP + ((HEIGHT - TOP - BOTTOM) * (high - score)) / (high - low);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    lines: starts.map(({ team, score }) => ({
      team,
      points: [
        [round1(x(0)), round1(y(score))],
        ...history.map((r, i): [number, number] => [
          round1(x(i + 1)),
          round1(y(r.teams.find((t) => t.id === team)?.score ?? 0)),
        ]),
      ],
    })),
    low,
    high,
    targetY: target === null ? null : round1(y(target)),
    rounds: history.map((r, i) => ({ round: r.round, x: round1(x(i + 1)) })),
    zeroY: low < 0 ? round1(y(0)) : null,
  };
}
