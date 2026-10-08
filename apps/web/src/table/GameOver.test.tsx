import type { TableInfo } from '@card-table/server/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMove, type GameState } from '@card-table/engine';
import { withZones } from '@card-table/engine/testing';
import { counting, createGame, gameMessage } from '../test/games';
import { GameOver } from './GameOver';

afterEach(cleanup);

const table = {
  code: 'TESTCODE01',
  game: { slug: 'counting', name: 'Counting', version: 1 },
  options: {},
  playerCount: 2,
  teams: null,
  status: 'finished',
  hostId: 'u0',
  seats: [
    { seat: 0, user: { id: 'u0', displayName: 'Arjun' }, connected: true },
    { seat: 1, user: { id: 'u1', displayName: 'Ana' }, connected: true },
  ],
} as unknown as TableInfo;

function showOver(state: GameState, seat: number) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <GameOver table={table} game={gameMessage(state, seat)} over={null} />,
    },
  ]);
  render(<RouterProvider router={router} />);
}

describe('GameOver', () => {
  it("shows the game's result notes", () => {
    // Playing to 2: the second card pairs the first, winning before the other player scores.
    const start = createGame(counting, { target: 2 }, 2, 'over-notes');
    const first = start.cursor.current;
    const other = 1 - first;
    const dealt = withZones(
      start,
      { [`hand@${first}`]: ['5H', '6H', '7H'], [`hand@${other}`]: ['5C', '6D', 'JS'] },
      'stock',
    );
    const over = [
      { player: first, card: '5H.0' },
      { player: other, card: '5C.0' },
    ].reduce((s, m) => applyMove(s, { ...m, type: 'play', to: 'pile' }), dealt);
    expect(over.status).toBe('over');
    showOver(over, first);
    expect(screen.getByText('Shutout!')).toBeTruthy();
  });
});
