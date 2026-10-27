import type { TableInfo } from '@card-table/server/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableConnection } from './connection';
import { Lobby } from './Lobby';

beforeEach(() => {
  // The rulebook loads with the lobby; it isn't what these tests look at.
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ games: [] }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lobby(seated: (string | null)[], teams: number[][] | null = null): TableInfo {
  return {
    code: 'TESTCODE01',
    game: { slug: 'spades', name: 'Spades', version: 1 },
    options: {},
    playerCount: seated.length,
    teams,
    status: 'lobby',
    hostId: 'u0',
    seats: seated.map((name, seat) => ({
      seat,
      user: name === null ? null : { id: `u${seat}`, displayName: name },
      connected: name !== null,
      bot: name?.startsWith('Bot') ?? false,
    })),
    botsAllowed: true,
    readingScores: [],
    rematch: null,
  };
}

function show(table: TableInfo, mySeat: number | null, isHost = false) {
  const connection = { send: vi.fn(() => Promise.resolve()) };
  render(
    <Lobby
      table={table}
      connection={connection as unknown as TableConnection}
      mySeat={mySeat}
      isHost={isHost}
    />,
  );
  return connection;
}

const seats = () => within(screen.getByRole('region', { name: 'Seats' })).getAllByRole('listitem');

describe('Lobby', () => {
  it('puts the seats around the table, yours at the bottom, in team colours', () => {
    show(
      lobby(
        ['Arjun', 'Ana', null, 'Bot 4'],
        [
          [0, 2],
          [1, 3],
        ],
      ),
      1,
    );
    const items = seats();
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Seat 1 · Team 1.*Arjun/),
      expect.stringMatching(/^Seat 2 · Team 2.*Ana \(you\)/),
      expect.stringMatching(/^Seat 3 · Team 1.*Empty/),
      expect.stringMatching(/^Seat 4 · Team 2.*Bot 4.*Bot/),
    ]);
    // Yours is at the bottom of the oval, as it will be at the table.
    expect(items[1]?.style.getPropertyValue('--y')).toBe('90');
    expect(items[1]?.style.getPropertyValue('--team')).toBe('var(--team-1)');
    expect(items[2]?.style.getPropertyValue('--team')).toBe('var(--team-0)');
    expect(screen.getByText('3 of 4 seats filled')).toBeTruthy();
    expect(screen.getByText('Team 1: seats 1 & 3')).toBeTruthy();
  });

  it('offers "Sit here" at an empty seat, or "Move here" once you have one', async () => {
    const connection = show(lobby(['Arjun', null]), null);
    fireEvent.click(screen.getByRole('button', { name: 'Sit here' }));
    // Let the messages go.
    await act(async () => {});
    expect(connection.send).toHaveBeenCalledWith({ type: 'sit', seat: 1 });
    cleanup();
    const again = show(lobby(['Arjun', null]), 0);
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    // Let the messages go.
    await act(async () => {});
    expect(again.send.mock.calls).toEqual([[{ type: 'stand' }], [{ type: 'sit', seat: 1 }]]);
  });

  it('gives the host the bot and seat buttons at each seat', () => {
    show(lobby(['Arjun', null, 'Bot 3']), 0, true);
    const [mine, empty, bot] = seats();
    expect(within(mine as HTMLElement).getByRole('button', { name: 'Leave seat' })).toBeTruthy();
    expect(within(empty as HTMLElement).getByRole('button', { name: 'Add bot' })).toBeTruthy();
    expect(within(bot as HTMLElement).getByRole('button', { name: 'Remove bot' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start the game' })).toHaveProperty('disabled', true);
  });

  it('starts from the middle of the felt on a computer, with what is still needed below', () => {
    show(lobby(['Arjun', null]), 0, true);
    const felt = within(screen.getByRole('region', { name: 'Seats' }));
    const start = felt.getByRole<HTMLButtonElement>('button', { name: 'Start the game' });
    expect(start.disabled).toBe(true);
    const actions = start.closest<HTMLElement>('.lobby-actions');
    if (!actions) throw new Error('No lobby actions');
    expect(within(actions).getByRole('button', { name: 'Rules' })).toBeTruthy();
    // Both buttons first, then the hint on its own line.
    expect([...actions.children].map((child) => child.textContent)).toEqual([
      'Start the gameRules',
      'Every seat needs a player to start.',
    ]);
  });

  it('starts from below the table on a phone, and only the host can start', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    show(lobby(['Arjun', 'Ana']), 1);
    const felt = within(screen.getByRole('region', { name: 'Seats' }));
    expect(felt.queryByRole('button', { name: 'Rules' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rules' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start the game' })).toBeNull();
    expect(screen.getByText('Waiting for the host to start the game.')).toBeTruthy();
  });
});
