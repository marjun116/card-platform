import type { GameSummary, TableInfo, VariantInfo } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { SessionContext } from '../useSession';
import { CreateTable } from './CreateTable';
import { Library } from './Library';

const me: User = { id: 'me', displayName: 'Arjun', signedIn: false };

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

function variant(code: string, name: string, owner = me, slug = 'spades'): VariantInfo {
  return {
    code,
    name,
    game: { slug, name: slug === 'spades' ? 'Spades' : 'Hearts' },
    options: { nil: false, targetScore: 300 },
    playerCount: 4,
    owner: { id: owner.id, displayName: owner.displayName },
  };
}

/** Requests the page made, as "METHOD /path" with the JSON body. */
let requests: { call: string; body: unknown }[];
let mine: VariantInfo[];
let shared: Record<string, VariantInfo>;

beforeEach(() => {
  requests = [];
  mine = [];
  shared = {};
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body: unknown = init.body ? JSON.parse(init.body as string) : undefined;
    requests.push({ call: `${method} ${path}`, body });
    const reply = (data: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(data), { status }));
    if (path === '/games') return reply({ games: [spades] });
    if (path === '/variants/mine') return reply({ variants: mine });
    if (method === 'POST' && path === '/variants') {
      const { name } = body as { name: string };
      return reply({ variant: variant('NEWCODE', name) }, 201);
    }
    if (method === 'POST' && path === '/tables') {
      return reply({ table: { code: 'TABLE1' } as TableInfo }, 201);
    }
    const code = /^\/variants\/(\w+)$/.exec(path)?.[1] ?? '';
    if (method === 'DELETE') return reply({ ok: true });
    const found = shared[code];
    return found ? reply({ variant: found }) : reply({ error: 'No variant with that code' }, 404);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/games', element: <Library /> },
      { path: '/games/:slug/new', element: <CreateTable /> },
      { path: '/t/:code', element: <p>At the table</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <SessionContext.Provider
      value={{ user: me, setUser: () => undefined, signOut: () => Promise.resolve() }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
}

const nilBox = () => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Allow nil bids' });
const playTo = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Play to' });

describe('creating a table from a variant', () => {
  it('starts from a shared link, and creates the table with its rules', async () => {
    shared.SHARED = variant('SHARED', "Grandma's Spades", {
      ...me,
      id: 'gran',
      displayName: 'Gran',
    });
    show('/games/spades/new?variant=SHARED');

    await screen.findByText("Starting from “Grandma's Spades”, saved by Gran.");
    expect(nilBox().checked).toBe(false);
    expect(playTo().selectedOptions[0]?.textContent).toBe('300');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Start from' }).value).toBe(
      'SHARED',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create table' }));
    await screen.findByText('At the table');
    expect(requests.find((r) => r.call === 'POST /tables')?.body).toEqual({
      game: 'spades',
      options: { nil: false, targetScore: 300 },
      playerCount: 4,
    });
  });

  it('switches between your variants and the standard rules', async () => {
    mine = [variant('MINE', 'Short game'), variant('HEARTS', 'Other game', me, 'hearts')];
    show('/games/spades/new');

    const from = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Start from' });
    // Only variants of this game are offered.
    expect([...from.options].map((o) => o.textContent)).toEqual(['Standard rules', 'Short game']);
    expect(nilBox().checked).toBe(true);
    fireEvent.change(from, { target: { value: 'MINE' } });
    expect(nilBox().checked).toBe(false);
    fireEvent.change(from, { target: { value: '' } });
    expect(nilBox().checked).toBe(true);
    expect(playTo().selectedOptions[0]?.textContent).toBe('500');
  });

  it('says when a shared link no longer works, and offers the standard rules', async () => {
    show('/games/spades/new?variant=GONE');
    await screen.findByText(/That variant link no longer works/);
    expect(nilBox().checked).toBe(true);
  });

  it('saves the chosen rules under a name and shows the share link', async () => {
    show('/games/spades/new');
    fireEvent.click(await screen.findByLabelText('Allow nil bids'));
    fireEvent.click(screen.getByRole('button', { name: 'Save as variant' }));
    fireEvent.change(screen.getByLabelText('Name these house rules'), {
      target: { value: ' Ours ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const link = await screen.findByLabelText<HTMLInputElement>(/Saved “Ours”/);
    expect(link.value).toBe(`${window.location.origin}/games/spades/new?variant=NEWCODE`);
    expect(requests.find((r) => r.call === 'POST /variants')?.body).toEqual({
      game: 'spades',
      name: 'Ours',
      options: { nil: false, targetScore: 500 },
      playerCount: 4,
    });
    // The new variant can be picked straight away.
    const from = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Start from' });
    expect(from.value).toBe('NEWCODE');
  });
});

describe('Your variants on the Games page', () => {
  it('lists them with a link to start a table, and deletes one after asking', async () => {
    mine = [variant('ONE', 'First'), variant('TWO', 'Second')];
    show('/games');

    const heading = await screen.findByRole('heading', { name: 'Your variants' });
    const list = within(heading.closest('section') as HTMLElement);
    expect(list.getAllByRole('link', { name: 'New table' })[0]?.getAttribute('href')).toBe(
      '/games/spades/new?variant=ONE',
    );

    vi.stubGlobal('confirm', () => false);
    fireEvent.click(list.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);
    expect(requests.some((r) => r.call.startsWith('DELETE'))).toBe(false);

    vi.stubGlobal('confirm', () => true);
    fireEvent.click(list.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);
    await waitFor(() => expect(list.queryByText('First')).toBeNull());
    expect(requests.some((r) => r.call === 'DELETE /variants/ONE')).toBe(true);
    expect(list.getByText('Second')).toBeTruthy();
  });

  it("doesn't show the section when you have none", async () => {
    show('/games');
    await screen.findByRole('heading', { name: 'Spades' });
    expect(screen.queryByRole('heading', { name: 'Your variants' })).toBeNull();
  });
});
