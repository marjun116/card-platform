import type { RoundResult } from '@card-table/engine';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreTrend } from './ScoreTrend';
import { trend } from './trend';

afterEach(cleanup);

/** Rounds with each team's [points, total]. */
function rounds(...teams: [number, number][][]): RoundResult[] {
  return teams.map((scores, i) => ({
    round: i + 1,
    dealer: 0,
    teams: scores.map(([points, score], id) => ({
      id,
      points,
      score,
      tricks: 0,
      tracks: {},
      held: {},
      parts: [],
      made: null,
    })),
    players: [],
  }));
}

const history = rounds(
  [
    [60, 60],
    [-40, -40],
  ],
  [
    [80, 140],
    [90, 50],
  ],
);

describe('trend', () => {
  it('starts each line where the game began and adds a point per round', () => {
    const chart = trend(history, null);
    expect(chart.lines.map((l) => l.points.length)).toEqual([3, 3]);
    expect(chart.rounds.map((r) => r.round)).toEqual([1, 2]);
    // The first team's line goes up each round (SVG's y grows downwards).
    const [a, b, c] = chart.lines[0]?.points.map(([, y]) => y) ?? [];
    expect(a).toBeGreaterThan(b ?? 0);
    expect(b).toBeGreaterThan(c ?? 0);
  });

  it('takes in negative scores and the target', () => {
    const chart = trend(history, 500);
    expect(chart.low).toBe(-40);
    expect(chart.high).toBe(500);
    expect(chart.zeroY).not.toBeNull();
    expect(chart.targetY).toBe(6);
  });

  it('has no zero line when nobody went below 0, and no target line without one', () => {
    const chart = trend(rounds([[10, 10]]), null);
    expect(chart.zeroY).toBeNull();
    expect(chart.targetY).toBeNull();
  });
});

describe('ScoreTrend', () => {
  it('draws a line per team in its colour, hidden from screen readers', () => {
    const { container } = render(<ScoreTrend history={history} target={500} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.trend-line')).toHaveLength(2);
    expect(container.querySelector('.trend-target')).toBeTruthy();
    expect((container.querySelector('g') as SVGGElement).style.getPropertyValue('--team')).toBe(
      'var(--team-0)',
    );
  });

  it('draws nothing before the first round is over', () => {
    const { container } = render(<ScoreTrend history={[]} target={null} />);
    expect(container.innerHTML).toBe('');
  });
});
