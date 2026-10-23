import type { PlayerView, RoundResult } from '@card-table/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoundSummary } from './RoundSummary';
import { HistoryTable } from './Scores';

afterEach(cleanup);

const NAMES = ['Raj', 'Bot 1', 'Ana', 'Bot 3'];
const names = (seat: number) => NAMES[seat] ?? `Seat ${seat}`;
const initials = (seat: number) => (NAMES[seat] ?? '?').slice(0, 2).toUpperCase();

const result: RoundResult = {
  round: 3,
  dealer: 1,
  teams: [
    {
      id: 0,
      points: 161,
      score: 312,
      tricks: 7,
      tracks: { bags: 3 },
      held: {},
      parts: [
        { label: 'Tricks', points: 60 },
        { label: 'Bags', points: 1 },
        { label: 'Nil', points: 100 },
      ],
      made: true,
    },
    {
      id: 1,
      points: -50,
      score: 120,
      tricks: 6,
      tracks: { bags: 0 },
      held: {},
      parts: [{ label: 'Set', points: -50 }],
      made: false,
    },
  ],
  players: [
    { id: 0, bid: 6, tricks: 7, tracks: {}, eliminated: false },
    { id: 1, bid: 3, tricks: 4, tracks: {}, eliminated: false },
    { id: 2, bid: 'nil', tricks: 0, tracks: {}, eliminated: false },
    { id: 3, bid: 4, tricks: 2, tracks: {}, eliminated: false },
  ],
};

const view: Pick<PlayerView, 'teams' | 'goal' | 'moments' | 'bidLabels' | 'trackLabels'> = {
  teams: [
    { id: 0, players: [0, 2], score: 312, tricks: 0, tracks: {}, held: {} },
    { id: 1, players: [1, 3], score: 120, tricks: 0, tracks: {}, held: {} },
  ],
  goal: { target: 500, winner: 'highestScore' },
  moments: [{ round: 3, at: 40, label: 'Set!', player: null, team: 1 }],
  bidLabels: { nil: 'Nil' },
  trackLabels: {},
};

function team(name: RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  return heading.closest('li') as HTMLElement;
}

describe('RoundSummary', () => {
  it('gives each team a card with its bid, tricks, points and where they came from', () => {
    render(<RoundSummary result={result} view={view} names={names} initials={initials} />);
    expect(screen.getByRole('list', { name: 'Round 3 results' })).toBeTruthy();

    const us = team(/Raj & Ana/);
    expect(within(us).getByText('Made')).toBeTruthy();
    expect(within(us).getByText('Bid 6 · took 7')).toBeTruthy();
    expect(us.querySelectorAll('.dot')).toHaveLength(7);
    expect(us.querySelectorAll('.dot.taken')).toHaveLength(7);
    expect(us.querySelectorAll('.dot.extra')).toHaveLength(1);
    expect(us.textContent).toContain('Bids: Raj 6, Ana Nil');
    expect(us.textContent).toContain('Tricks +60 · Bags +1 · Nil +100');
    expect(us.textContent).toContain('+161');
    expect(us.textContent).toContain('188 to go');
    expect(us.textContent).toContain('Bags 3');

    const them = team(/Bot 1 & Bot 3/);
    expect(within(them).getByText('Set')).toBeTruthy();
    expect(within(them).getByText('Bid 7 · took 6')).toBeTruthy();
    expect(them.querySelectorAll('.dot.taken')).toHaveLength(6);
  });

  it('crowns the leader, in words for screen readers too', () => {
    render(<RoundSummary result={result} view={view} names={names} initials={initials} />);
    expect(screen.getByRole('heading', { name: /Raj & Ana.*\(leading\)/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Bot 1 & Bot 3.*leading/ })).toBeNull();
  });

  it('crowns the lowest score where the lowest wins, and says where the game ends', () => {
    const low = { ...view, goal: { target: 100, winner: 'lowestScore' as const } };
    render(<RoundSummary result={result} view={low} names={names} initials={initials} />);
    expect(screen.getByRole('heading', { name: /Bot 1 & Bot 3.*\(leading\)/ })).toBeTruthy();
    expect(screen.getAllByText('game ends at 100')).toHaveLength(2);
  });

  it('lists highlights, moments first', () => {
    render(<RoundSummary result={result} view={view} names={names} initials={initials} />);
    const notes = within(screen.getByRole('list', { name: 'Highlights' })).getAllByRole('listitem');
    expect(notes.map((n) => n.textContent)).toEqual([
      '★ Team 2 (Bot 1 & Bot 3): Set!',
      '★ Raj took 7 tricks',
    ]);
  });

  it('leaves out what the game has none of: no target, contract, bids or labels', () => {
    const plain: RoundResult = {
      ...result,
      teams: result.teams.map((t) => ({
        ...t,
        made: null,
        parts: [{ label: null, points: t.points }],
      })),
      players: result.players.map((p) => ({ ...p, bid: null })),
    };
    const noGoal = { ...view, goal: { target: null, winner: 'highestScore' as const } };
    const { container } = render(
      <RoundSummary result={plain} view={noGoal} names={names} initials={initials} />,
    );
    expect(container.querySelector('.made-badge')).toBeNull();
    expect(container.querySelector('.goal-bar')).toBeNull();
    expect(container.querySelector('.dot')).toBeNull();
    expect(container.querySelector('.summary-parts')).toBeNull();
    expect(screen.getByText('Took 7 tricks')).toBeTruthy();
  });

  it('offers to show all hands, where it can', () => {
    const onShowHands = vi.fn();
    render(
      <RoundSummary
        result={result}
        view={view}
        names={names}
        initials={initials}
        onShowHands={onShowHands}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all hands' }));
    expect(onShowHands).toHaveBeenCalledOnce();
    cleanup();
    render(<RoundSummary result={result} view={view} names={names} initials={initials} />);
    expect(screen.queryByRole('button', { name: 'Show all hands' })).toBeNull();
  });
});

describe('HistoryTable', () => {
  it("offers each round's hands", () => {
    const onShowHands = vi.fn();
    render(
      <HistoryTable
        history={[{ ...result, round: 1 }, result]}
        teams={view.teams}
        names={names}
        onShowHands={onShowHands}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all hands, round 3' }));
    expect(onShowHands).toHaveBeenCalledWith(3);
  });
});
