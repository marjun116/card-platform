import { applyMove, type GameState, type Move } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { SUIT_SYMBOL } from './cards';
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
    readingScores: [],
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

/** The first legal move of whoever is to act. */
function firstMove(state: GameState): Move {
  const move = gameMessage(state, state.cursor.current).legalMoves[0];
  if (!move) throw new Error('Nobody can move');
  return move;
}

/** True when that move would end the round. */
const applyMoveEndsRound = (state: GameState) =>
  applyMove(state, firstMove(state)).history.length > state.history.length;

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

  it('outlines the card winning the trick so far, and says whose it is', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'view-leading'),
      (s) => (s.trick?.plays.length ?? 0) === 2,
    );
    const viewer = state.cursor.current;
    show(state, viewer);
    const leading = gameMessage(state, viewer).view.trick?.leading as number;
    expect(state.trick?.plays.map((p) => p.player)).toContain(leading);
    const trick = within(screen.getByRole('group', { name: 'Current trick' }));
    const card = trick.getByRole('img', { name: /, winning$/ });
    expect(card.getAttribute('aria-label')).toMatch(new RegExp(`^${NAMES[leading]}: `));
    expect(card.classList.contains('won')).toBe(true);
    expect(trick.getByRole('status').textContent).toBe(`${NAMES[leading]} is winning`);
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
    // The button stays in place, greyed out while the finished trick is on the table.
    const button = () => screen.getByRole<HTMLButtonElement>('button', { name: /trick$/ });
    expect(button().textContent).toBe('Last trick');
    expect(button().disabled).toBe(true);

    const led = playUntil(done, (s) => (s.trick?.plays.length ?? 0) === 1);
    update(led);
    expect(screen.getByRole('group', { name: 'Current trick' })).toBeTruthy();
    expect(button().disabled).toBe(false);

    // Looking back lasts until the next trick is finished.
    fireEvent.click(button());
    expect(screen.getByRole('group', { name: 'Last trick' })).toBeTruthy();
    expect(button().textContent).toBe('Show current trick');
    const nextDone = playUntil(led, (s) => (s.trick?.plays.length ?? 0) === 0);
    update(nextDone);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Last trick');
    update(playUntil(nextDone, (s) => (s.trick?.plays.length ?? 0) === 1));
    expect(screen.getByRole('group', { name: 'Current trick' })).toBeTruthy();
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the finished round on the table until the next deal, and says who it waits for', () => {
    // Spades, just before the move that ends the first round.
    let state = createGame(spades, {}, 4, 'view-hold');
    while (!applyMoveEndsRound(state)) state = applyMove(state, firstMove(state));
    const held = applyMove(state, firstMove(state), { holdNextRound: true });
    show(held, 0, { table: { ...tableInfo(4), readingScores: [1] } });
    expect(screen.getByRole('group', { name: 'Last trick' })).toBeTruthy();
    expect(screen.getByText(`Waiting for ${NAMES[1]} to close the round scores…`)).toBeTruthy();
    cleanup();
    show(held, 0);
    expect(
      screen.getByText('The next hand is dealt once everyone has closed the round scores.'),
    ).toBeTruthy();
  });

  it("marks the dealer's seat, or tells you when you're the dealer", () => {
    const state = createGame(spades, {}, 4, 'view-dealer');
    const viewer = (state.dealer + 1) % 4;
    show(state, viewer);
    const dealer = screen.getByRole('region', { name: `${NAMES[state.dealer]}, dealer` });
    expect(dealer.classList.contains('dealer')).toBe(true);
    expect(within(dealer).getByText('Dealer').className).toBe('dealer-tag');
    expect(screen.queryByText(/You're the dealer/)).toBeNull();
    cleanup();
    show(state, state.dealer);
    expect(screen.getByText(/You're the dealer\./)).toBeTruthy();
  });

  it('lets you hide the round scores to look at the table, then show them or carry on', () => {
    const before = playUntil(createGame(spades, {}, 4, 'view-hide'), (s) => applyMoveEndsRound(s));
    const { connection, update } = show(before, 0);
    update(applyMove(before, firstMove(before), { holdNextRound: true }));
    const dialog = () => screen.queryByRole('heading', { name: 'Round 1 scores' });
    expect(dialog()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide to see the table' }));
    expect(dialog()).toBeNull();
    expect(screen.getByText('Round 1 is over.')).toBeTruthy();
    expect(connection.send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Show scores' }));
    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide to see the table' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(connection.send).toHaveBeenCalledWith({ type: 'roundSeen' });
    expect(screen.queryByText('Round 1 is over.')).toBeNull();
    expect(dialog()).toBeNull();
  });

  it('stays on the finished table until you ask for the results', () => {
    // Only the status matters here: a game that has just ended.
    const end: GameState = { ...createGame(spades, {}, 4, 'view-over'), status: 'over' };
    const onShowResults = vi.fn();
    render(
      <TableView
        table={{ ...tableInfo(4), status: 'finished' }}
        game={gameMessage(end, 0)}
        connection={fakeConnection() as unknown as TableConnection}
        error={null}
        nudgedBy={null}
        isHost
        onShowResults={onShowResults}
      />,
    );
    expect(screen.getByText('The game is over.')).toBeTruthy();
    // The host can't pause or end a game that's over.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'See results' }));
    expect(onShowResults).toHaveBeenCalledTimes(1);
  });

  it('shows no Last trick button in games without tricks', () => {
    show(createGame(miniRummy, {}, 2, 'view-no-tricks'), 0);
    expect(screen.queryByRole('button', { name: /trick$/ })).toBeNull();
  });

  it('leaves off piles the game keeps off the table, unless you can use them', () => {
    const file = {
      ...miniRummy,
      zones: {
        ...miniRummy.zones,
        stock: {
          shared: true,
          visibility: 'none' as const,
          countVisible: true,
          showOnTable: 'false',
        },
      },
    };
    const state = createGame(file, {}, 2, 'view-off-table');
    const waiting = 1 - state.cursor.current;
    show(state, waiting);
    expect(screen.queryByLabelText(/^Stock,/)).toBeNull();
    expect(screen.getByLabelText(/^Discard,/)).toBeTruthy();
    cleanup();
    show(state, state.cursor.current);
    expect(screen.getByLabelText(/^Stock,/)).toBeTruthy();
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

  describe('cards passed to you', () => {
    /** Everyone but the last to pass has passed; returns the state and who's last. */
    function allButLast() {
      let state = createGame(passing, {}, 4, 'view-received');
      for (let i = 0; i < 3; i++) state = applyMove(state, firstMove(state));
      return { state, last: state.cursor.current };
    }

    it('raises them for a few seconds with who sent them', () => {
      vi.useFakeTimers();
      try {
        const { state, last } = allButLast();
        const receiver = (last + 1) % 4;
        const { update } = show(state, receiver);
        const after = applyMove(state, firstMove(state));
        act(() => update(after));
        const got = after.passes.find((p) => p.to === receiver)?.cards ?? [];
        const raised = hand()
          .getAllByRole('button')
          .filter((b) => b.classList.contains('received'));
        expect(raised).toHaveLength(got.length);
        expect(raised[0]?.getAttribute('aria-label')).toContain(`from ${NAMES[last]}`);
        expect(screen.getByText(`From ${NAMES[last]}:`, { exact: false })).toBeTruthy();
        // Screen readers hear which cards came.
        expect(document.querySelector('[aria-live]')?.textContent).toContain(
          `${NAMES[last]} passed you`,
        );
        act(() => {
          vi.advanceTimersByTime(4000);
        });
        expect(screen.queryByText(`From ${NAMES[last]}:`, { exact: false })).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("doesn't raise them when you open the table after they came", () => {
      const { state, last } = allButLast();
      show(applyMove(state, firstMove(state)), (last + 1) % 4);
      expect(screen.queryByText(`From ${NAMES[last]}:`, { exact: false })).toBeNull();
    });
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
    const { update, connection } = show(almost, 0);
    expect(screen.queryByText('Round 1 scores')).toBeNull();
    const seat = almost.cursor.current;
    const last = gameMessage(almost, seat).legalMoves[0] as Move;
    update(applyMove(almost, last));
    expect(screen.getByText('Round 1 scores')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Round 1 results' })).toBeTruthy();

    // Closing it tells the server, so the bots can carry on.
    expect(connection.send).not.toHaveBeenCalled();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    dialog.removeAttribute('open');
    fireEvent(dialog, new Event('close'));
    expect(connection.send).toHaveBeenCalledWith({ type: 'roundSeen' });
    expect(screen.queryByText('Round 1 scores')).toBeNull();
  });

  it('says who the bots are waiting on while someone reads the round scores', () => {
    const state = createGame(spades, {}, 4, 'view-reading');
    // A bot is to act; the viewer and one other person have the scores open.
    const bot = state.cursor.current;
    const [viewer = 0, reader = 0] = [0, 1, 2, 3].filter((s) => s !== bot);
    const base = tableInfo(4);
    const seats = base.seats.map((s) => ({ ...s, bot: s.seat === bot }));
    show(state, viewer, { table: { ...base, seats, readingScores: [viewer, reader] } });
    expect(
      screen.getByText(`Waiting for ${NAMES[reader] ?? ''} to close the round scores…`),
    ).toBeTruthy();
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

  it('gives every player an avatar in their team colour, hidden from screen readers', () => {
    const state = createGame(spades, {}, 4, 'view-avatars');
    show(state, 0);
    const avatarOf = (name: string) =>
      screen.getByRole('region', { name: new RegExp(`^${name}`) }).querySelector('.avatar');
    const sam = avatarOf('Sam');
    const ana = avatarOf('Ana');
    expect(sam?.textContent).toBe('S');
    // Partners share a colour; opponents have another.
    expect(sam?.getAttribute('style')).toContain('var(--team-0)');
    expect(ana?.getAttribute('style')).toContain('var(--team-1)');
    // The letters are decorative (the name is written beside them); the here/away dot isn't.
    expect(sam?.querySelector('.avatar-letters')?.getAttribute('aria-hidden')).toBe('true');
    expect(within(sam as HTMLElement).getByRole('img', { name: 'here' })).toBeTruthy();
    // Your own avatar uses your name, not "You".
    expect(document.querySelector('.status-line .avatar')?.textContent).toBe('A');
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

describe('TableView: suits', () => {
  it('shows trump in a badge on the table, and says which cards in your hand are trump (spades)', () => {
    const state = createGame(spades, {}, 4, 'view-trump');
    show(state, 0);
    expect(screen.getByRole('img', { name: 'Trump: spades' }).textContent).toContain('♠');
    const cards = hand().getAllByRole('button');
    for (const card of cards) {
      const spade = /of spades/.test(card.getAttribute('aria-label') ?? '');
      // Said to screen readers only: no mark on the card itself.
      expect(card.getAttribute('aria-label')?.includes(', trump')).toBe(spade);
      expect(card.querySelector('.trump-mark')).toBeNull();
    }
  });

  it('has no trump badge in games without trump', () => {
    show(createGame(sevensUp, {}, 3, 'view-no-trump'), 0);
    expect(screen.queryByRole('img', { name: /^Trump/ })).toBeNull();
  });

  it('says which suit was led in the middle of the trick, until the trick is won', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'view-led'),
      (s) => (s.trick?.plays.length ?? 0) === 1,
    );
    const led = state.trick?.plays[0]?.card;
    if (!led || !('suit' in led)) throw new Error('no card led');
    const { update } = show(state, state.cursor.current);
    const trick = () => within(screen.getByRole('group', { name: /trick$/ }));
    // The symbol is drawn; screen readers get the suit's name.
    expect(trick().getByText('Led').textContent).toBe(`Led ${SUIT_SYMBOL[led.suit]}${led.suit}`);
    update(playUntil(state, (s) => s.trick?.winner != null || s.trick?.plays.length === 0));
    expect(trick().queryByText('Led')).toBeNull();
  });

  it('offers a large tile per suit when choosing one, with its name', () => {
    const state = playUntil(
      createGame(sevensUp, {}, 3, 'view-suits'),
      (s) => s.pending?.kind === 'chooseSuit',
    );
    const seat = state.pending?.player as number;
    const { connection } = show(state, seat);
    const choice = within(screen.getByRole('group', { name: 'Choose a suit' }));
    const tiles = choice.getAllByRole('button');
    expect(tiles.map((t) => t.textContent)).toEqual(['♣Clubs', '♦Diamonds', '♥Hearts', '♠Spades']);
    fireEvent.click(choice.getByRole('button', { name: 'Hearts' }));
    expect(connection.move).toHaveBeenCalledWith({
      player: seat,
      type: 'chooseSuit',
      suit: 'hearts',
    });
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
      `${NAMES[other]} played 5♣ to the pile`,
    ]);
    // The card is drawn small in the line, and named in full for screen readers.
    const played = log.getAllByRole('listitem')[1] as HTMLElement;
    expect(within(played).getByRole('img', { name: '5 of clubs' }).className).toContain(
      'inline-card',
    );
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
    // The contract's suit symbol is coloured, inside the value.
    const contract = screen.getByText('Contract').parentElement as HTMLElement;
    expect(contract.textContent).toBe('Contract 1♣');
    expect(within(contract).getByText('♣').className).toBe('suit-pip black');
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
