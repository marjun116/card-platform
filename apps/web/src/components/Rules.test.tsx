import type { GameSummary, TableInfo } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesPage } from '../pages/RulesPage';
import { rulebookReady, useRulebook } from '../useRulebook';
import { AtThisTable, RulesDialog, RulesText } from './Rules';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const spades: GameSummary = {
  slug: 'spades',
  name: 'Spades',
  players: [4],
  teams: [
    [0, 2],
    [1, 3],
  ],
  partnersWith: [4],
  options: {
    nil: { label: 'Allow nil bids', type: 'boolean', default: true },
    targetScore: { label: 'Play to', type: 'choice', values: [300, 500, 1000], default: 500 },
  },
};

const table: TableInfo = {
  code: 'ABC',
  game: { slug: 'spades', name: 'Spades', version: 1 },
  options: { nil: true, targetScore: 300 },
  playerCount: 4,
  teams: spades.teams,
  status: 'playing',
  hostId: 'a',
  seats: [0, 1, 2, 3].map((seat) => ({
    seat,
    user: seat === 3 ? null : { id: `u${seat}`, displayName: ['Ann', 'Bob', 'Cat'][seat] ?? '' },
    connected: true,
    bot: false,
  })),
  botsAllowed: true,
  readingScores: [],
};

const rules =
  '# Spades\n\nSpades are **always** trump.\n\n## Play\n\n- Follow suit.\n- <b>Never</b> HTML.';

beforeEach(() => {
  vi.stubGlobal('fetch', (url: string) => {
    const reply = (data: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(data), { status }));
    if (url === '/api/games') return reply({ games: [spades] });
    if (url === '/api/games/spades/rules') return reply({ rules });
    return reply({ error: 'No rules for that game' }, 404);
  });
});

describe('RulesText', () => {
  it('shows sections, lists and bold, but never HTML from the text', () => {
    const { container } = render(<RulesText source={rules} level={3} />);
    // The title is left to the page or dialog around it.
    expect(screen.queryByText('Spades')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Play' })).toBeTruthy();
    expect(screen.getByText('always').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Follow suit.',
      '<b>Never</b> HTML.',
    ]);
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('At this table', () => {
  it('lists the players, partners and house rules, marking the changed ones', () => {
    render(<AtThisTable table={table} game={spades} />);
    const section = within(screen.getByRole('region', { name: 'At this table' }));
    expect(section.getByText('4 players')).toBeTruthy();
    expect(section.getByText('Team 1: Ann and Cat')).toBeTruthy();
    expect(section.getByText('Team 2: Bob and Seat 4')).toBeTruthy();
    expect(section.getByText('Allow nil bids').nextElementSibling?.textContent).toBe('On');
    expect(section.getByText('Play to').nextElementSibling?.textContent).toBe('300 (changed)');
    expect(section.queryByText('This table plays the standard rules.')).toBeNull();
  });

  it('says when the table plays the standard rules', () => {
    render(
      <AtThisTable table={{ ...table, options: { nil: true, targetScore: 500 } }} game={spades} />,
    );
    expect(screen.getByText('This table plays the standard rules.')).toBeTruthy();
  });
});

/** The rules pop-up as the lobby and table use it: loaded up front, opened once ready. */
function RulesButton({ onClose = () => undefined }: { onClose?: () => void }) {
  const book = useRulebook(table.game.slug);
  return rulebookReady(book) ? <RulesDialog table={table} book={book} onClose={onClose} /> : null;
}

describe('RulesDialog', () => {
  it("opens complete, with this table's settings and the written rules", async () => {
    render(<RulesButton />);
    expect(screen.queryByRole('heading', { name: 'Spades rules' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Spades rules' })).toBeTruthy();
    // Everything is there the moment it opens: no loading message, nothing still to come.
    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Play' })).toBeTruthy();
    expect(screen.getByText('(changed)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('closes on a click outside it, but not on one inside it', async () => {
    const onClose = vi.fn();
    render(<RulesButton onClose={onClose} />);
    const title = await screen.findByRole('heading', { name: 'Spades rules' });
    const dialog = title.closest('dialog');
    if (!dialog) throw new Error('No dialog');
    // jsdom has no layout: place the dialog by hand.
    dialog.getBoundingClientRect = () => new DOMRect(100, 100, 400, 300);
    fireEvent.click(title);
    fireEvent.click(dialog, { clientX: 300, clientY: 200 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('RulesPage', () => {
  function show(path: string) {
    const router = createMemoryRouter([{ path: '/games/:slug/rules', element: <RulesPage /> }], {
      initialEntries: [path],
    });
    render(<RouterProvider router={router} />);
  }

  it("shows a game's rules with a link to start a table", async () => {
    show('/games/spades/rules');
    expect(await screen.findByRole('heading', { level: 1, name: 'Spades rules' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New table' }).getAttribute('href')).toBe(
      '/games/spades/new',
    );
  });

  it("says when there's no such game", async () => {
    show('/games/nope/rules');
    expect(await screen.findByText(/There's no game called/)).toBeTruthy();
  });
});
