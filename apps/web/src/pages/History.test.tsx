/** The Past games page: filters, date groups, richer rows and "Play again". */
import type { GameStats, PastGame, PastGameCount } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { SessionContext } from '../useSession';
import { History } from './History';

const me: User = { id: 'me', displayName: 'Me', signedIn: false };

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

const hearts: PastGameCount = { game: { slug: 'hearts', name: 'Hearts' }, count: 2 };

let pages: Record<number, { games: PastGame[]; more: boolean }>;
let played: PastGameCount[];
let stats: GameStats[];
/** The history pages asked for: their query strings. */
let historyQueries: string[];
let rematchCodes: string[];

beforeEach(() => {
  pages = { 0: { games: [], more: false } };
  played = [];
  stats = [];
  historyQueries = [];
  rematchCodes = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)));
    const rematch = /^\/api\/tables\/(\w+)\/rematch$/.exec(url);
    if (init?.method === 'POST' && rematch) {
      rematchCodes.push(rematch[1] ?? '');
      return reply({ code: 'AGAIN1' });
    }
    if (url === '/api/stats') return reply({ stats });
    if (url === '/api/history/games') return reply({ games: played });
    const query = url.split('?')[1] ?? '';
    historyQueries.push(query);
    const offset = Number(new URLSearchParams(query).get('offset') ?? 0);
    return reply(pages[offset] ?? { games: [], more: false });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show() {
  const router = createMemoryRouter(
    [
      { path: '/history', element: <History /> },
      { path: '/t/:code', element: <p>The table</p> },
    ],
    { initialEntries: ['/history'] },
  );
  render(
    <SessionContext.Provider
      value={{ user: me, setUser: () => undefined, signOut: () => Promise.resolve() }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
}

async function pastGames() {
  return within(await screen.findByRole('region', { name: 'Past games' }));
}

/** The text of each team in a game's final scores, in order. */
function finalScores(section: Awaited<ReturnType<typeof pastGames>>, game: RegExp) {
  const row = section.getByRole('link', { name: game }).closest('li') as HTMLElement;
  const scores = within(row).getByRole('list', { name: 'Final scores' });
  return within(scores)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
}

describe('Past games', () => {
  it('lists finished games with the outcome and scores, linking to each', async () => {
    pages[0] = { games: [past('WON', [0]), past('EARLY', [], 'abandoned')], more: false };
    played = [hearts];
    stats = [{ game: { slug: 'hearts', name: 'Hearts' }, played: 1, won: 1 }];
    show();

    const section = await pastGames();
    const won = await section.findByRole('link', { name: /You won/ });
    expect(won.getAttribute('href')).toBe('/t/WON');
    // Finishing order, as on the results page: the lowest score wins at hearts.
    expect(finalScores(section, /You won/)).toEqual(['MYou40♛ (winner)', 'B3Bot 360', 'AAnn101']);
    const early = section.getByRole('link', { name: /Ended early/ }).closest('li') as HTMLElement;
    const players = within(early).getByRole('list', { name: 'Players' });
    expect(
      within(players)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['MYou', 'AAnn', 'B3Bot 3']);
    expect(await section.findByText('Hearts: 1 played, 1 won')).toBeTruthy();
    expect(section.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('loads older games on request', async () => {
    pages[0] = { games: [past('ONE', [1])], more: true };
    pages[1] = { games: [past('TWO', [0])], more: false };
    played = [hearts];
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
    expect(section.queryByRole('group', { name: 'Outcome' })).toBeNull();
  });

  it('filters by game and outcome on the server, from the first page', async () => {
    pages[0] = { games: [past('WON', [0])], more: false };
    played = [
      { ...hearts, count: 3 },
      { game: { slug: 'spades', name: 'Spades' }, count: 1 },
    ];
    show();
    const section = await pastGames();
    await section.findByRole('link', { name: /You won/ });
    const games = section.getByRole('group', { name: 'Game' });
    const chip = (name: string) => within(games).getByRole('button', { name });
    expect(
      within(games)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All', 'Hearts', 'Spades']);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');

    pages[0] = { games: [], more: false };
    fireEvent.click(chip('Spades'));
    expect(await section.findByText('No past games match.')).toBeTruthy();
    expect(chip('Spades').getAttribute('aria-pressed')).toBe('true');
    const outcome = section.getByRole('group', { name: 'Outcome' });
    fireEvent.click(within(outcome).getByRole('button', { name: 'Ended early' }));
    await vi.waitFor(() => expect(historyQueries).toHaveLength(3));
    expect(historyQueries).toEqual([
      'offset=0',
      'offset=0&game=spades',
      'offset=0&game=spades&outcome=early',
    ]);
    fireEvent.click(chip('All'));
    await vi.waitFor(() => expect(historyQueries.at(-1)).toBe('offset=0&outcome=early'));
  });

  it('has no game chips with only one game', async () => {
    pages[0] = { games: [past('WON', [0])], more: false };
    played = [hearts];
    show();
    const section = await pastGames();
    await section.findByRole('link', { name: /You won/ });
    expect(section.queryByRole('group', { name: 'Game' })).toBeNull();
    expect(section.getByRole('group', { name: 'Outcome' })).toBeTruthy();
  });

  it('groups games by date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 18, 0));
    const at = (month: number, day: number) => new Date(2026, month, day, 12).toISOString();
    pages[0] = {
      games: [
        past('TODAY', [0], 'finished', at(9, 15)),
        past('MONDAY', [0], 'finished', at(9, 12)),
        past('FIRST', [0], 'finished', at(9, 1)),
        past('SEPT', [1], 'finished', at(8, 30)),
      ],
      more: false,
    };
    played = [hearts];
    try {
      show();
      const section = await pastGames();
      await section.findAllByRole('link', { name: /Hearts/ });
      const headings = section.getAllByRole('heading', { level: 3 });
      expect(headings.map((h) => h.textContent)).toEqual([
        'Today',
        'This week',
        'Earlier this month',
        'Older',
      ]);
      const older = headings[3]?.parentElement as HTMLElement;
      expect(within(older).getByRole('link').getAttribute('href')).toBe('/t/SEPT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays again with the same players, from a finished game only', async () => {
    pages[0] = { games: [past('WON', [0]), past('EARLY', [], 'abandoned')], more: false };
    played = [hearts];
    show();
    const section = await pastGames();
    const buttons = await section.findAllByRole('button', {
      name: /^Play again with these players/,
    });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Play again with these players: Ann and Bot 3');
    fireEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByText('The table')).toBeTruthy();
    expect(rematchCodes).toEqual(['WON']);
  });
});
