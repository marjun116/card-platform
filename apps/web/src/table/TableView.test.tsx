import { applyMove, type GameState, type Move } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGame,
  gameMessage,
  miniRummy,
  passing,
  playUntil,
  sevensUp,
  spades,
} from '../test/games';
import type { TableConnection } from './connection';
import { TableView } from './TableView';

afterEach(cleanup);

const NAMES = ['Arjun', 'Ana', 'Sam', 'Raj'];

function tableInfo(players: number): TableInfo {
  return {
    code: 'TESTCODE01',
    game: { slug: 'test', name: 'Test', version: 1 },
    options: {},
    playerCount: players,
    teams: null,
    status: 'playing',
    hostId: 'u0',
    seats: Array.from({ length: players }, (_, seat) => ({
      seat,
      user: { id: `u${seat}`, displayName: NAMES[seat] ?? `P${seat}` },
      connected: true,
    })),
  };
}

function fakeConnection() {
  return {
    move: vi.fn<(move: Move) => Promise<void>>(() => Promise.resolve()),
    send: vi.fn(() => Promise.resolve()),
    dismissError: vi.fn(),
    dismissNudge: vi.fn(),
  };
}

/** Renders the table as `seat` sees `state`. */
function show(state: GameState, seat: number) {
  const connection = fakeConnection();
  const props = {
    table: tableInfo(state.players.length),
    connection: connection as unknown as TableConnection,
    error: null,
    nudgedBy: null,
    isHost: false,
  };
  const result = render(<TableView {...props} game={gameMessage(state, seat)} />);
  const update = (next: GameState) =>
    result.rerender(<TableView {...props} game={gameMessage(next, seat)} />);
  return { connection, update };
}

const hand = () => within(screen.getByRole('group', { name: /^Your hand/ }));

describe('TableView', () => {
  it('offers the bids from the legal moves and sends the one picked (spades)', () => {
    const state = createGame(spades, {}, 4, 'view-bid');
    const seat = state.cursor.current;
    const { connection } = show(state, seat);
    const bids = within(screen.getByRole('group', { name: 'Your bid' }));
    fireEvent.click(bids.getByRole('button', { name: '3' }));
    expect(connection.move).toHaveBeenCalledWith({ player: seat, type: 'bid', value: 3 });
  });

  it('plays a card on the second press, and never offers illegal cards (spades)', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'view-play'),
      (s) => (s.trick?.plays.length ?? 0) === 1,
    );
    const seat = state.cursor.current;
    const { connection } = show(state, seat);
    const cards = hand().getAllByRole('button');
    const legal = gameMessage(state, seat).legalMoves;
    const usable = cards.filter((c) => c.getAttribute('aria-disabled') === 'false');
    expect(usable).toHaveLength(legal.length);

    // Pressing an unusable card does nothing.
    const unusable = cards.find((c) => c.getAttribute('aria-disabled') === 'true');
    if (unusable) fireEvent.click(unusable);
    expect(connection.move).not.toHaveBeenCalled();

    const card = usable[0] as HTMLElement;
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(connection.move).not.toHaveBeenCalled();
    fireEvent.click(card);
    expect(connection.move).toHaveBeenCalledTimes(1);
    expect(legal).toContainEqual(connection.move.mock.calls[0]?.[0]);
  });

  it('shows the trick by who played each card', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'view-trick'),
      (s) => (s.trick?.plays.length ?? 0) === 2,
    );
    const viewer = state.cursor.current;
    show(state, viewer);
    const trick = within(screen.getByRole('group', { name: 'Current trick' }));
    for (const play of state.trick?.plays ?? []) {
      expect(trick.getByRole('img', { name: new RegExp(`^${NAMES[play.player]}: `) })).toBeTruthy();
    }
  });

  it('builds a pass from selected cards (hearts-like passing)', () => {
    const state = createGame(passing, {}, 4, 'view-pass');
    const seat = state.cursor.current;
    const { connection } = show(state, seat);
    expect(screen.getByText(/Choose 3 cards to pass/)).toBeTruthy();
    const target = gameMessage(state, seat).legalMoves[0] as Extract<Move, { type: 'pass' }>;
    const buttons = hand().getAllByRole('button');
    for (const id of target.cards) {
      const label = buttons.find((b) => b.querySelector(`img[src*="${id.split('.')[0]}"]`));
      fireEvent.click(label as HTMLElement);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Pass 3 cards' }));
    const sent = connection.move.mock.calls[0]?.[0] as Extract<Move, { type: 'pass' }>;
    expect([...sent.cards].sort()).toEqual([...target.cards].sort());
  });

  it('draws from a pile by pressing it (rummy)', () => {
    const state = createGame(miniRummy, {}, 2, 'view-draw');
    const seat = state.cursor.current;
    const { connection } = show(state, seat);
    fireEvent.click(
      screen.getByRole('button', { name: /^Stock, \d+ cards\. Draw from the stock$/ }),
    );
    expect(connection.move).toHaveBeenCalledWith({ player: seat, type: 'draw', from: 'stock' });
    // The discard pile shows its top card.
    expect(screen.getByRole('button', { name: /^Discard, 1 card, .+ on top\./ })).toBeTruthy();
  });

  it('moves between cards with the arrow keys', () => {
    const state = createGame(spades, {}, 4, 'view-keys');
    show(state, 0);
    const cards = hand().getAllByRole('button');
    expect(cards.map((c) => c.tabIndex)).toEqual([0, ...Array<number>(12).fill(-1)]);
    cards[0]?.focus();
    fireEvent.keyDown(cards[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cards[1]);
    fireEvent.keyDown(cards[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(cards[12]);
  });

  it('shows a summary when a round finishes', () => {
    const almost = playUntil(
      createGame(spades, { mercyRule: false }, 4, 'view-round'),
      (s) => s.cursor.tricks === 12 && s.trick?.plays.length === 3,
    );
    const { update } = show(almost, 0);
    expect(screen.queryByText('Round 1 scores')).toBeNull();
    const seat = almost.cursor.current;
    const last = gameMessage(almost, seat).legalMoves[0] as Move;
    update(applyMove(almost, last));
    expect(screen.getByText('Round 1 scores')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Round 1 results' })).toBeTruthy();
  });

  it('announces the latest move for screen readers', () => {
    const state = playUntil(createGame(spades, {}, 4, 'view-live'), (s) => s.log.length === 1);
    show(state, 0);
    const first = state.log[0] as Extract<Move, { type: 'bid' }>;
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain(
      `${NAMES[first.player] ?? ''} bid`,
    );
  });

  it('gives each other player a chip with their stats, which opens their details', () => {
    const state = createGame(sevensUp, {}, 6, 'view-chips');
    show(state, 0);
    const chip = screen.getByRole('button', { name: /^Ana, 7 cards.*\. Details$/ });
    expect(screen.getAllByRole('button', { name: /\. Details$/ })).toHaveLength(5);
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the space under the hand, and puts focus back on the card after Clear', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'view-clear'),
      (s) => (s.trick?.plays.length ?? 0) === 1,
    );
    show(state, state.cursor.current);
    const bar = screen.getByRole('group', { name: 'Moves with your cards' });
    expect(bar.childElementCount).toBe(0);

    const card = hand()
      .getAllByRole('button')
      .find((c) => c.getAttribute('aria-disabled') === 'false') as HTMLElement;
    fireEvent.click(card);
    // The same row now holds the buttons; nothing was added around it.
    expect(screen.getByRole('group', { name: 'Moves with your cards' })).toBe(bar);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(bar.childElementCount).toBe(0);
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });
});
