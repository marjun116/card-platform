import type { GameSummary } from '@card-table/server/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { GameTile } from './GameTile';

afterEach(cleanup);

const hearts: GameSummary = {
  slug: 'hearts',
  name: 'Hearts',
  players: [3, 4, 5],
  teams: null,
  partnersWith: [],
  options: { passing: { label: 'Passing', type: 'boolean', default: true } },
  minutes: null,
  cards: ['10H', 'QS', 'JOKER'],
  accent: 6,
};

function show(game: GameSummary, compact = false) {
  const router = createMemoryRouter([
    { path: '/', element: <ul>{<GameTile game={game} compact={compact} />}</ul> },
  ]);
  render(<RouterProvider router={router} />);
}

describe('GameTile', () => {
  it('fans three real cards in the game colour, hidden from screen readers', () => {
    show(hearts);
    const tile = document.querySelector('.game-tile') as HTMLElement;
    expect(tile.style.getPropertyValue('--game')).toBe('var(--team-6)');
    const fan = tile.querySelector('.tile-fan');
    expect(fan?.getAttribute('aria-hidden')).toBe('true');
    expect(fan?.querySelectorAll('.card.face')).toHaveLength(3);
  });

  it('shows the player count, house rules and buttons; no length if the game has none', () => {
    show(hearts);
    expect(screen.getByRole('heading', { name: 'Hearts' })).toBeTruthy();
    expect(screen.getByText('3–5 players')).toBeTruthy();
    expect(document.querySelectorAll('.chip')).toHaveLength(1);
    expect(screen.getByText(/House rules: Passing/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New table' }).getAttribute('href')).toBe(
      '/games/hearts/new',
    );
  });

  it('is one link to a new table when compact', () => {
    show({ ...hearts, minutes: [30, 60] }, true);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Hearts' }).getAttribute('href')).toBe(
      '/games/hearts/new',
    );
    expect(screen.getByText('30–60 min')).toBeTruthy();
    expect(screen.queryByText(/House rules/)).toBeNull();
  });
});
