import type { GameSummary, PastGame, TableInfo } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { SessionContext } from '../useSession';
import { Home } from './Home';
import { RECENT_GAMES } from './PastGames';

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

/** A three-player hearts game (lowest score wins) that ended on `endedAt`. */
function past(
  code: string,
  winners: number[],
  status: PastGame['status'] = 'finished',
  endedAt = '2026-10-10T12:00:00.000Z',
): PastGame {
  return {
    code,
    game: { slug: 'hearts', name: 'Hearts' },
    status,
    endedAt,
    seats: [
      { seat: 0, displayName: 'Me', bot: false },
      { seat: 1, displayName: 'Ann', bot: false },
      { seat: 2, displayName: 'Bot 3', bot: true },
    ],
    you: 0,
    seatTeams: [0, 1, 2],
    winners,
    teams:
      status === 'finished'
        ? [
            { team: 0, players: [0], score: 40 },
            { team: 1, players: [1], score: 101 },
            { team: 2, players: [2], score: 60 },
          ]
        : null,
    lowestWins: true,
  };
}

let pages: Record<number, { games: PastGame[]; more: boolean }>;
let myTables: TableInfo[];
let deletedCodes: string[];

beforeEach(() => {
  pages = { 0: { games: [], more: false } };
  myTables = [];
  deletedCodes = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)));
    if (init?.method === 'DELETE') {
      deletedCodes.push(url.split('/').pop() ?? '');
      return reply({ ok: true });
    }
    if (url === '/api/tables/mine') return reply({ tables: myTables });
    if (url === '/api/games') return reply({ games: [spades] });
    const query = url.split('?')[1] ?? '';
    const offset = Number(new URLSearchParams(query).get('offset') ?? 0);
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

/** Lays the page out as on a phone (the 700px breakpoint). */
function phone() {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
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

  it('comes first, before the games, for someone coming back to a game', async () => {
    myTables = [table('MINE01', 'me')];
    show();
    await screen.findByRole('heading', { name: 'Your tables' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Your tables', 'Start a game', 'Recent games']);
  });

  it('is always there on a wide screen, saying when there are none', async () => {
    show();
    expect(await screen.findByText('No games in progress.')).toBeTruthy();
  });

  it("isn't there on a phone when you have no tables, and past games are a link", async () => {
    phone();
    show();
    await screen.findByRole('list', { name: 'Games' });
    expect(screen.queryByRole('heading', { name: 'Your tables' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recent games' })).toBeNull();
    const link = screen.getByRole('link', { name: 'Past games →' });
    expect(link.getAttribute('href')).toBe('/history');
  });

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

describe('Recent games', () => {
  async function recent() {
    const heading = await screen.findByRole('heading', { name: 'Recent games' });
    return within(heading.closest('section') as HTMLElement);
  }

  it(`shows your last ${RECENT_GAMES} games, linking to each and to the full list`, async () => {
    const games = Array.from({ length: 7 }, (_, i) => past(`G${i}`, [i % 2]));
    pages[0] = { games, more: false };
    show();
    const section = await recent();
    await section.findAllByRole('link', { name: /^Hearts\s*You won/ });
    const links = section.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/t/G0',
      '/t/G1',
      '/t/G2',
      '/t/G3',
      '/t/G4',
      '/history',
    ]);
    expect(links[1]?.textContent).toContain('You lost');
  });

  it('says where games will appear before the first one', async () => {
    show();
    const section = await recent();
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
