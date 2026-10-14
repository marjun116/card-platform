import { applyMove, type GameState, type Move } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  counting,
  createGame,
  dummyGame,
  gameMessage,
  miniRummy,
  passing,
  playUntil,
  sevensUp,
  spades,
  wildRummy,
} from '../test/games';
import { withZones } from '@card-table/engine/testing';
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
      bot: false,
    })),
    botsAllowed: true,
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
function show(
  state: GameState,
  seat: number,
  { table = tableInfo(state.players.length), isHost = false } = {},
) {
  const connection = fakeConnection();
  const props = {
    table,
    connection: connection as unknown as TableConnection,
    error: null,
    nudgedBy: null,
    isHost,
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

  it('keeps a finished trick on the table until the next card is led', () => {
    const done = playUntil(
      createGame(spades, {}, 4, 'view-last-trick'),
      (s) => s.lastTrick !== null && (s.trick?.plays.length ?? 0) === 0,
    );
    const viewer = done.cursor.current;
    const { update } = show(done, viewer);
    const trick = within(screen.getByRole('group', { name: 'Last trick' }));
    expect(trick.getAllByRole('img', { name: /^\w+: / })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Last trick' })).toBeNull();

    const led = playUntil(done, (s) => (s.trick?.plays.length ?? 0) === 1);
    update(led);
    expect(screen.getByRole('group', { name: 'Current trick' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Last trick' })).toBeTruthy();
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

describe('TableView: hands you arrange (wild rummy)', () => {
  function arranged() {
    const base = createGame(wildRummy, {}, 2, 'view-arrange');
    const seat = base.cursor.current;
    const dealt = withZones(base, { [`hand@${seat}`]: ['3H', '4H', '5H', '9C', 'KD'] }, 'stock');
    const state = applyMove(dealt, {
      player: seat,
      type: 'arrange',
      groups: [['3H.0', '4H.0', '5H.0']],
    });
    return { state, seat };
  }

  it('shows each group and what it is, with your deadwood', () => {
    const { state, seat } = arranged();
    show(state, seat);
    const summary = screen.getByLabelText('Your groups');
    expect(summary.textContent).toContain('✓ Pure run (3)');
    expect(summary.textContent).toContain('Deadwood: 19');
  });

  it('groups the cards you select, and sorts your hand on request', () => {
    const { state, seat } = arranged();
    const { connection } = show(state, seat);
    fireEvent.click(hand().getByRole('button', { name: /9 of clubs/i }));
    fireEvent.click(hand().getByRole('button', { name: /king of diamonds/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    expect(connection.move).toHaveBeenLastCalledWith({
      player: -1,
      type: 'arrange',
      groups: [
        ['3H.0', '4H.0', '5H.0'],
        ['9C.0', 'KD.0'],
      ],
    });
  });

  it('offers "Sort into melds" when nothing is selected', () => {
    const { state, seat } = arranged();
    const { connection } = show(state, seat);
    fireEvent.click(screen.getByRole('button', { name: 'Sort into melds' }));
    expect(connection.move).toHaveBeenLastCalledWith({ player: seat, type: 'sortHand' });
  });
});

describe('TableView: scoring as cards are played (counting game)', () => {
  /** Two players: the first to play holds 5H 6H 7H, the other 5C 6D JS; the first two cards are played. */
  function pairPlayed() {
    const start = createGame(counting, {}, 2, 'view-count');
    const first = start.cursor.current;
    const other = 1 - first;
    const dealt = withZones(
      start,
      { [`hand@${first}`]: ['5H', '6H', '7H'], [`hand@${other}`]: ['5C', '6D', 'JS'] },
      'stock',
    );
    const play = (s: GameState, player: number, card: string) =>
      applyMove(s, { player, type: 'play', card, to: 'pile' });
    return { state: play(play(dealt, first, '5H.0'), other, '5C.0'), first, other };
  }

  it('shows the points scored in the log, after the move that scored them', () => {
    const { state, first, other } = pairPlayed();
    show(state, first);
    const log = within(screen.getByRole('region', { name: 'Game log' }));
    const lines = log.getAllByRole('listitem').map((li) => li.textContent);
    // Newest first.
    expect(lines.slice(0, 2)).toEqual([
      `${NAMES[other]}: Pair for 2`,
      `${NAMES[other]} played 5 of clubs to the pile`,
    ]);
  });

  it("shows the game's values on the table", () => {
    const { state, first } = pairPlayed();
    show(state, first);
    expect(screen.getByText('Total').parentElement?.textContent).toBe('Total 10');
  });

  it('spreads out a face-up pile so every card in it can be seen', () => {
    const { state, first } = pairPlayed();
    show(state, first);
    const pile = screen.getByRole('img', { name: /^Pile, 2 cards/ });
    expect(pile.getAttribute('aria-label')).toBe('Pile, 2 cards, 5 of hearts, 5 of clubs');
    expect(within(pile).getAllByRole('img')).toHaveLength(2);
  });
});

describe('TableView: a wide range of bids', () => {
  /** Spades, but bidding from 20 to 60 (as in a pinochle auction), with nil still allowed. */
  const auction = {
    ...spades,
    phases: spades.phases.map((phase, i) =>
      i === 0
        ? {
            ...phase,
            actions: [
              { type: 'bid' as const, values: { range: [20, 60] as [number, number] } },
              { type: 'bid' as const, values: ['nil'], if: 'options.nil' },
            ],
          }
        : phase,
    ),
  };

  it('shows the lowest bids as buttons and the rest in a list', () => {
    const state = createGame(auction, {}, 4, 'view-auction');
    const seat = state.cursor.current;
    const { connection } = show(state, seat);
    const bids = within(screen.getByRole('group', { name: 'Your bid' }));
    for (const value of ['20', '25', 'Nil'])
      expect(bids.getByRole('button', { name: value })).toBeTruthy();
    expect(bids.queryByRole('button', { name: '26' })).toBeNull();
    const list = bids.getByRole('combobox', { name: 'Higher bid' });
    expect(within(list).getAllByRole('option')).toHaveLength(35);
    fireEvent.change(list, { target: { value: '10' } });
    fireEvent.click(bids.getByRole('button', { name: 'Bid 36' }));
    expect(connection.move).toHaveBeenCalledWith({ player: seat, type: 'bid', value: 36 });
  });

  it('keeps a button per bid for spades', () => {
    const state = createGame(spades, {}, 4, 'view-spades-bids');
    show(state, state.cursor.current);
    const bids = within(screen.getByRole('group', { name: 'Your bid' }));
    expect(bids.queryByRole('combobox')).toBeNull();
    expect(bids.getByRole('button', { name: '13' })).toBeTruthy();
  });
});

describe('a hand played by another seat (bridge-style dummy)', () => {
  /** The dealer bids 1♣ and declares; the opening lead is made; it's the dummy's turn. */
  function atDummysTurn() {
    let state = createGame(dummyGame, {}, 4, 'web-dummy');
    const declarer = state.dealer;
    state = applyMove(state, { player: declarer, type: 'bid', value: 11 });
    state = playUntil(
      state,
      (s) => s.cursor.phase === 1,
      (moves) => moves.find((m) => m.type === 'passBid'),
    );
    const before = state;
    state = playUntil(state, (s) => s.trick?.plays.length === 1);
    return { before, state, declarer, dummy: (declarer + 2) % 4, leader: (declarer + 1) % 4 };
  }
  const openHand = (name: string) =>
    screen.queryByRole('group', { name: new RegExp(`^${name}'s hand, face up`) });

  it('shows the dummy face up only after the opening lead', () => {
    const { before, state, dummy, leader } = atDummysTurn();
    const { update } = show(before, leader);
    expect(openHand(NAMES[dummy] as string)).toBeNull();
    update(state);
    const cards = within(openHand(NAMES[dummy] as string) as HTMLElement);
    expect(cards.getAllByRole('img')).toHaveLength(4);
    // Someone who doesn't play it can only look.
    expect(cards.queryAllByRole('button')).toHaveLength(0);
  });

  it("lets the declarer play the dummy's cards, saying whose they are", () => {
    const { state, declarer, dummy } = atDummysTurn();
    const { connection } = show(state, declarer);
    const name = NAMES[dummy] as string;
    expect(screen.getByText(`Your turn: choose a card for ${name}.`)).toBeTruthy();
    expect(screen.getByText(/Played by you/)).toBeTruthy();
    const cards = within(openHand(name) as HTMLElement);
    const playable = cards
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-disabled') === 'false');
    expect(playable.length).toBeGreaterThan(0);
    const card = playable[0] as HTMLElement;
    fireEvent.click(card);
    fireEvent.click(card);
    expect(connection.move).toHaveBeenCalledWith(
      expect.objectContaining({ player: dummy, by: declarer, type: 'playToTrick' }),
    );
  });

  it('tells the dummy who is playing their cards, and offers them nothing', () => {
    const { state, declarer, dummy } = atDummysTurn();
    show(state, dummy);
    expect(screen.getByText(new RegExp(`${NAMES[declarer]} is playing your cards`))).toBeTruthy();
    expect(screen.getByText(/^Waiting for/)).toBeTruthy();
  });

  it('shows display labels, seats as names, and counters by their labels', () => {
    const { state, declarer } = atDummysTurn();
    show(state, (declarer + 1) % 4);
    expect(screen.getByText('1♣')).toBeTruthy();
    const display = screen.getByText('Declarer').parentElement as HTMLElement;
    expect(display.textContent).toContain(NAMES[declarer]);
    cleanup();
    // After a hand: "Hands played" is shown; the hidden counter isn't.
    const after = playUntil(state, (s) => s.round > 1);
    show(after, 0);
    const scores = within(screen.getByRole('region', { name: 'Scores' }));
    expect(scores.getAllByText(/Hands played 1/).length).toBeGreaterThan(0);
    expect(scores.queryByText(/Secret/)).toBeNull();
  });
});

describe('bots at the table', () => {
  /** Seat 1 is a bot; seat 2's player has left. */
  function withBotAndAbsentee(): TableInfo {
    const table = tableInfo(4);
    return {
      ...table,
      seats: table.seats.map((s) =>
        s.seat === 1
          ? { ...s, user: { id: 'bot-2', displayName: 'Bot 2' }, bot: true }
          : s.seat === 2
            ? { ...s, connected: false }
            : s,
      ),
    };
  }

  it('lets the host replace a player who left with a bot', () => {
    const state = createGame(spades, {}, 4, 'view-bots');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { connection } = show(state, 0, { table: withBotAndAbsentee(), isHost: true });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Sam with a bot' }));
    expect(connection.send).toHaveBeenCalledWith({ type: 'replaceWithBot', seat: 2 });
    // Only players who left: not the bot, nor anyone still here.
    expect(screen.queryByRole('button', { name: /Replace Bot 2/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Replace Raj/ })).toBeNull();
    confirm.mockRestore();
  });

  it('shows bots as bots, never nudged, and offers other players nothing', () => {
    let state = createGame(spades, {}, 4, 'view-bots-2');
    state = playUntil(state, (s) => s.cursor.current === 1);
    show(state, 0, { table: withBotAndAbsentee() });
    const seat = screen.getByRole('region', { name: /^Bot 2/ });
    expect(within(seat).getByText(/Bot/, { selector: '.seat-facts' })).toBeTruthy();
    expect(within(seat).queryByRole('button', { name: /Nudge/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Replace/ })).toBeNull();
  });
});
