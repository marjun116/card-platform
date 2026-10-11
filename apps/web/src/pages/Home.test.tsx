import type { GameStats, PastGame } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { SessionContext } from '../useSession';
import { Home } from './Home';

const me: User = { id: 'me', displayName: 'Me', signedIn: false };

function past(code: string, winners: number[], status: PastGame['status'] = 'finished'): PastGame {
  return {
    code,
    game: { slug: 'hearts', name: 'Hearts' },
    status,
    endedAt: '2026-10-10T12:00:00.000Z',
    seats: [
      { seat: 0, displayName: 'Me', bot: false },
      { seat: 1, displayName: 'Ann', bot: false },
      { seat: 2, displayName: 'Bot 3', bot: true },
    ],
    you: 0,
    winners,
    teams:
      status === 'finished'
        ? [
            { players: [0], score: 40 },
            { players: [1], score: 101 },
            { players: [2], score: 60 },
          ]
        : null,
  };
}

let pages: Record<number, { games: PastGame[]; more: boolean }>;
let stats: GameStats[];

beforeEach(() => {
  pages = { 0: { games: [], more: false } };
  stats = [];
  vi.stubGlobal('fetch', (url: string) => {
    const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)));
    if (url === '/api/tables/mine') return reply({ tables: [] });
    if (url === '/api/stats') return reply({ stats });
    const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? 0);
    return reply(pages[offset] ?? { games: [], more: false });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show() {
  const router = createMemoryRouter([{ path: '/', element: <Home /> }]);
  render(
    <SessionContext.Provider
      value={{ user: me, setUser: () => undefined, signOut: () => Promise.resolve() }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
}

async function pastGames() {
  const heading = await screen.findByRole('heading', { name: 'Past games' });
  return within(heading.closest('section') as HTMLElement);
}

describe('Past games', () => {
  it('lists finished games with the outcome and scores, linking to each', async () => {
    pages[0] = { games: [past('WON', [0]), past('EARLY', [], 'abandoned')], more: false };
    stats = [{ game: { slug: 'hearts', name: 'Hearts' }, played: 1, won: 1 }];
    show();

    const section = await pastGames();
    const won = await section.findByRole('link', { name: /You won/ });
    expect(won.getAttribute('href')).toBe('/t/WON');
    expect(won.textContent).toContain('You 40 · Ann 101 · Bot 3 60');
    const early = section.getByRole('link', { name: /Ended early/ });
    expect(early.textContent).toContain('You, Ann, Bot 3');
    expect(await section.findByText('Hearts: 1 played, 1 won')).toBeTruthy();
    expect(section.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('loads older games on request', async () => {
    pages[0] = { games: [past('ONE', [1])], more: true };
    pages[1] = { games: [past('TWO', [0])], more: false };
    show();

    const section = await pastGames();
    await section.findByRole('link', { name: /You lost/ });
    fireEvent.click(section.getByRole('button', { name: 'Show more' }));
    expect(await section.findByRole('link', { name: /You won/ })).toBeTruthy();
    expect(section.getAllByRole('link')).toHaveLength(2);
    expect(section.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('says where games will appear before the first one', async () => {
    show();
    const section = await pastGames();
    expect(await section.findByText('Games you finish will show up here.')).toBeTruthy();
  });
});
