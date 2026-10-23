import type { GameStats, GameSummary, PastGame, TableInfo } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { SessionContext } from '../useSession';
import { Home } from './Home';

const me: User = { id: 'me', displayName: 'Me', signedIn: false };

const spades: GameSummary = {
  slug: 'spades',
  name: 'Spades',
  players: [4],
  teams: [
    [0, 2],
    [1, 3],
  ],
  partnersWith: [4],
  options: {},
  minutes: [45, 90],
  cards: ['AS', 'KS', 'QS'],
  accent: 0,
};

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
let myTables: TableInfo[];
let deletedCodes: string[];

beforeEach(() => {
  pages = { 0: { games: [], more: false } };
  stats = [];
  myTables = [];
  deletedCodes = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)));
    if (init?.method === 'DELETE') {
      deletedCodes.push(url.split('/').pop() ?? '');
      return reply({ ok: true });
    }
    if (url === '/api/tables/mine') return reply({ tables: myTables });
    if (url === '/api/stats') return reply({ stats });
    if (url === '/api/games') return reply({ games: [spades] });
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

describe('Your tables', () => {
  const table = (code: string, hostId: string): TableInfo =>
    ({
      code,
      game: { slug: 'euchre', name: 'Euchre', version: 1 },
      status: 'playing',
      hostId,
      seats: [{ seat: 0, user: { id: 'me', displayName: 'Me' }, connected: true, bot: false }],
    }) as TableInfo;

  it('lets the host delete a table, after checking', async () => {
    myTables = [table('MINE01', 'me'), table('THEIRS', 'ann')];
    show();
    const remove = await screen.findByRole('button', { name: 'Delete this Euchre table' });
    expect(screen.getAllByRole('button', { name: /^Delete/ })).toHaveLength(1);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(remove);
    expect(deletedCodes).toEqual([]);
    confirm.mockReturnValueOnce(true);
    fireEvent.click(remove);
    expect(confirm).toHaveBeenLastCalledWith(
      "Delete this Euchre table? The game ends and won't appear in past games.",
    );
    expect(deletedCodes).toEqual(['MINE01']);
    await vi.waitFor(() =>
      expect(screen.queryAllByRole('link', { name: /Euchre/ })).toHaveLength(1),
    );
  });
});

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

describe('Home: start a game', () => {
  it('shows every game as a tile that starts a new table', async () => {
    show();
    const games = await screen.findByRole('list', { name: 'Games' });
    const link = within(games).getByRole('link', { name: 'Spades' });
    expect(link.getAttribute('href')).toBe('/games/spades/new');
    expect(within(games).getByText('4 players, 2 teams')).toBeTruthy();
    expect(within(games).getByText('45–90 min')).toBeTruthy();
  });
});
