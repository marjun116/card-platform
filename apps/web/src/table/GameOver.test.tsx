import type { TableInfo } from '@card-table/server/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMove, type GameState } from '@card-table/engine';
import { withZones } from '@card-table/engine/testing';
import { counting, createGame, gameMessage } from '../test/games';
import type { GameMessage } from './connection';
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
  rematch: null,
  seats: [
    { seat: 0, user: { id: 'u0', displayName: 'Arjun' }, connected: true },
    { seat: 1, user: { id: 'u1', displayName: 'Ana' }, connected: true },
  ],
} as unknown as TableInfo;

function showOver(
  game: GameMessage,
  { celebrate = false, info = table }: { celebrate?: boolean; info?: TableInfo } = {},
) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <GameOver table={info} game={game} over={null} celebrate={celebrate} />,
    },
  ]);
  render(<RouterProvider router={router} />);
}

/** A finished game of counting to 2: the second card pairs the first, so its player wins. */
function finished(): { over: GameState; winner: number; loser: number } {
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
  const [winner = -1] = over.winners;
  return { over, winner, loser: 1 - winner };
}

describe('GameOver', () => {
  it("shows the game's result notes", () => {
    const { over, winner } = finished();
    showOver(gameMessage(over, winner));
    expect(screen.getByText('Shutout!')).toBeTruthy();
  });

  it('says you won, with the winner marked in the final scores', () => {
    const { over, winner } = finished();
    showOver(gameMessage(over, winner));
    expect(screen.getByRole('heading', { level: 1, name: 'You win!' })).toBeTruthy();
    const scores = within(screen.getByRole('region', { name: 'Final scores' }));
    expect(scores.getAllByRole('listitem')[0]?.textContent).toMatch(/You.*\(winner\)/);
  });

  it('says "Good game" when you lose, then who won', () => {
    const { over, winner, loser } = finished();
    showOver(gameMessage(over, loser));
    expect(screen.getByRole('heading', { level: 1, name: 'Good game' })).toBeTruthy();
    expect(screen.getByText(`${['Arjun', 'Ana'][winner]} wins!`)).toBeTruthy();
  });

  it('throws confetti only when you watched the game end', () => {
    const { over, winner } = finished();
    showOver(gameMessage(over, winner));
    expect(document.querySelector('.confetti')).toBeNull();
    cleanup();
    showOver(gameMessage(over, winner), { celebrate: true });
    const confetti = document.querySelector('.confetti');
    expect(confetti?.getAttribute('aria-hidden')).toBe('true');
    expect(confetti?.children.length).toBeGreaterThan(0);
  });

  it('puts three or more teams on a podium, in finishing order, and lists the rest', () => {
    const { over, winner } = finished();
    const game = gameMessage(over, winner);
    const team = (id: number, score: number) => ({
      id,
      players: [id],
      score,
      tricks: 0,
      tracks: {},
      held: {},
    });
    const four: GameMessage = {
      ...game,
      view: {
        ...game.view,
        you: 0,
        winners: [2],
        goal: { ...game.view.goal, winner: 'highestScore' },
        teams: [team(0, 40), team(1, 90), team(2, 120), team(3, 10)],
      },
    };
    const names = ['Arjun', 'Ana', 'Sam', 'Raj'];
    const info = {
      ...table,
      playerCount: 4,
      seats: names.map((displayName, seat) => ({
        seat,
        user: { id: `u${seat}`, displayName },
        connected: true,
      })),
    } as unknown as TableInfo;
    showOver(four, { info });
    const podium = document.querySelector('.podium') as HTMLElement;
    const places = within(podium)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(places).toEqual([
      expect.stringMatching(/^1st.*Sam.*\(winner\).*120/),
      expect.stringMatching(/^2nd.*Ana.*90/),
      expect.stringMatching(/^3rd.*You.*40/),
    ]);
    const rest = document.querySelector('.standings') as HTMLElement;
    expect(rest.textContent).toMatch(/4th.*Raj.*10/);
  });

  it("shows the game's stats, leaving out what the game doesn't have", () => {
    const { over, winner } = finished();
    showOver(gameMessage(over, winner));
    // Counting has no tricks or bids, only points.
    const stats = screen.queryByRole('heading', { name: 'Game stats' });
    const biggest = over.history.some((r) => r.teams.some((t) => t.points > 0));
    expect(stats !== null).toBe(biggest);
    expect(screen.queryByRole('columnheader', { name: 'Tricks won' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Bids made' })).toBeNull();
  });

  describe('rematch', () => {
    let setInfo: (info: TableInfo) => void = () => undefined;

    /** The results page with a connection, whose table info can change (as the server's does). */
    function Harness({
      game,
      connection,
    }: {
      game: GameMessage;
      connection: { send: () => Promise<void> };
    }) {
      const [info, set] = useState(table);
      setInfo = set;
      return <GameOver table={info} game={game} over={null} connection={connection} />;
    }

    function showWithConnection(game: GameMessage) {
      const connection = { send: vi.fn(() => Promise.resolve()) };
      const router = createMemoryRouter([
        { path: '/', element: <Harness game={game} connection={connection} /> },
        { path: '/t/:code', element: <p>The rematch lobby</p> },
      ]);
      render(<RouterProvider router={router} />);
      return { connection, router };
    }

    it('asks for a rematch, then goes to its lobby', async () => {
      const { over, winner } = finished();
      const { connection, router } = showWithConnection(gameMessage(over, winner));
      fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
      // The server's ack.
      await act(async () => {});
      expect(connection.send).toHaveBeenCalledWith({ type: 'rematch' });
      act(() => setInfo({ ...table, rematch: { code: 'AGAIN00001', by: winner } }));
      expect(router.state.location.pathname).toBe('/t/AGAIN00001');
      expect(screen.getByText('The rematch lobby')).toBeTruthy();
    });

    it('says when someone else started one, with a link to join', () => {
      const { over, winner, loser } = finished();
      showWithConnection(gameMessage(over, loser));
      act(() => setInfo({ ...table, rematch: { code: 'AGAIN00001', by: winner } }));
      expect(screen.getByRole('status').textContent).toBe(
        `${['Arjun', 'Ana'][winner]} started a rematch, with everyone in the same seats.`,
      );
      const join = screen.getByRole('link', { name: 'Join the rematch' });
      expect(join.getAttribute('href')).toBe('/t/AGAIN00001');
      expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
    });

    it('offers none for a game the host ended, or without a connection', () => {
      const { over, winner } = finished();
      showOver(gameMessage(over, winner), { info: { ...table, status: 'abandoned' } });
      expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
      cleanup();
      showOver(gameMessage(over, winner));
      expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Play Counting again' })).toBeTruthy();
    });
  });
});
