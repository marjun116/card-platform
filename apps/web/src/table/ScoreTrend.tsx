/**
 * Each team's total after every round as a small line chart, in plain SVG. It
 * repeats the "Every round" table beside it, so screen readers skip it.
 */
import type { RoundResult } from '@card-table/engine';
import { teamColour } from './avatars';
import { BOTTOM, HEIGHT, LEFT, RIGHT, TOP, trend, WIDTH } from './trend';

export function ScoreTrend({
  history,
  target,
}: {
  history: readonly RoundResult[];
  target: number | null;
}) {
  if (history.length === 0) return null;
  const chart = trend(history, target);
  // Label every round while they fit, then every few.
  const every = Math.ceil(history.length / 10);
  return (
    <svg
      className="score-trend"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <text className="trend-label" x={LEFT - 4} y={TOP + 4} textAnchor="end">
        {chart.high}
      </text>
      <text className="trend-label" x={LEFT - 4} y={HEIGHT - BOTTOM} textAnchor="end">
        {chart.low}
      </text>
      <line
        className="trend-axis"
        x1={LEFT}
        x2={WIDTH - RIGHT}
        y1={HEIGHT - BOTTOM}
        y2={HEIGHT - BOTTOM}
      />
      {chart.zeroY !== null && (
        <line
          className="trend-axis"
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={chart.zeroY}
          y2={chart.zeroY}
        />
      )}
      {chart.targetY !== null && (
        <line
          className="trend-target"
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={chart.targetY}
          y2={chart.targetY}
        />
      )}
      {chart.rounds
        .filter((_, i) => (i + 1) % every === 0 || i === chart.rounds.length - 1)
        .map(({ round, x }) => (
          <text key={round} className="trend-label" x={x} y={HEIGHT - 3} textAnchor="middle">
            {round}
          </text>
        ))}
      {chart.lines.map(({ team, points }) => {
        const [lastX, lastY] = points[points.length - 1] ?? [0, 0];
        return (
          <g key={team} style={{ ['--team' as string]: teamColour(team) }}>
            <polyline className="trend-line" points={points.map((p) => p.join(',')).join(' ')} />
            <circle className="trend-end" cx={lastX} cy={lastY} r={3} />
          </g>
        );
      })}
    </svg>
  );
}
