import { replayRound, type RoundReplay } from '@card-table/engine';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';
import { createGame, gameMessage, playUntil, spades } from '../test/games';
import { ReplayDialog } from './ReplayDialog';
import { replayZones, shownTrick } from './replay';

const NAMES = ['Raj', 'Bot 1', 'Ana', 'Bot 3'];
const names = (seat: number) => NAMES[seat] ?? `Seat ${seat}`;
const initials = (seat: number) => (NAMES[seat] ?? '?').slice(0, 2).toUpperCase();

// A spades game one round in, and that round played back as the server sends it.
const state = playUntil(createGame(spades, {}, 4, 'replay-web'), (s) => s.history.length === 1);
const replay = replayRound(spades, {}, 4, 'replay-web', state.log, 1) as RoundReplay;
const view = gameMessage(state, 0).view;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function open(load: () => Promise<RoundReplay> = () => Promise.resolve(replay)) {
  const spy = vi.spyOn(api, 'roundReplay').mockImplementation(load);
  const onClose = vi.fn();
  render(
    <ReplayDialog
      code="TESTCODE01"
      round={1}
      view={view}
      names={names}
      initials={initials}
      onClose={onClose}
    />,
  );
  await act(async () => {});
  return { spy, onClose };
}

const caption = () => document.querySelector('.replay-caption')?.textContent ?? '';
const button = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('replayZones', () => {
  it("shows every player's hand face up, and piles as the table does", () => {
    const zones = replayZones(replay.frames[0]!, replay.trickZones);
    expect([...zones.seats.keys()].sort()).toEqual([0, 1, 2, 3]);
    for (const [, list] of zones.seats) {
      expect(list[0]?.name).toBe('hand');
      expect(list[0]?.view.kind === 'cards' && list[0].view.cards).toHaveLength(13);
    }
    for (const [, list] of zones.teams) {
      for (const zone of list) expect(zone.view.kind).not.toBe('cards');
    }
    expect(zones.piles.some((z) => replay.trickZones.includes(z.name))).toBe(false);
  });
});

describe('shownTrick', () => {
  it('shows the trick being played, then the finished one with its winner', () => {
    const fourth = replay.moves.filter((m) => m.type === 'playToTrick')[3];
    const at = replay.moves.indexOf(fourth!) + 1;
    expect(shownTrick(replay.frames[at - 1]!, replay.moves[at - 2]!)?.plays).toHaveLength(3);
    const done = shownTrick(replay.frames[at]!, replay.moves[at - 1]!);
    expect(done?.plays).toHaveLength(4);
    expect(done?.winner).not.toBeNull();
    // Nothing once the next move isn't a card to the trick (or before any is played).
    expect(shownTrick(replay.frames[0]!, null)).toBeNull();
  });
});

describe('ReplayDialog', () => {
  it('asks the server for the round, then starts at the deal with every hand face up', async () => {
    const { spy } = await open();
    expect(spy).toHaveBeenCalledWith('TESTCODE01', 1);
    expect(screen.getByRole('heading', { name: 'Round 1: all hands' })).toBeTruthy();
    expect(caption()).toContain('The deal');
    expect(caption()).toContain(`${names(replay.dealer)} dealt.`);
    const seats = document.querySelectorAll('.replay-seat');
    expect(seats).toHaveLength(4);
    for (const seat of seats) expect(seat.querySelectorAll('.card')).toHaveLength(13);
  });

  it('steps through the moves, saying each one', async () => {
    await open();
    const last = replay.frames.length - 1;
    expect((button('Back') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('Forward'));
    expect(caption()).toContain(`Move 1 of ${last}`);
    expect(caption()).toContain(`${names(replay.moves[0]!.player)} bid`);
    fireEvent.click(button('End'));
    expect(caption()).toContain(`Move ${last} of ${last}`);
    expect((button('Forward') as HTMLButtonElement).disabled).toBe(true);
    // At the end of the round every hand is empty.
    for (const seat of document.querySelectorAll('.replay-seat')) {
      expect(seat.querySelectorAll('.card')).toHaveLength(0);
    }
    fireEvent.click(button('Start'));
    expect(caption()).toContain('The deal');
  });

  it('plays the round at a steady pace until paused', async () => {
    vi.useFakeTimers();
    await open();
    // Each step renders before the next is timed.
    const wait = (steps: number) => {
      for (let i = 0; i < steps; i++) {
        act(() => {
          vi.advanceTimersByTime(1100);
        });
      }
    };
    fireEvent.click(button('Play'));
    wait(3);
    expect(caption()).toContain('Move 3 of');
    fireEvent.click(button('Pause'));
    wait(3);
    expect(caption()).toContain('Move 3 of');
  });

  it('shows the trick as it is played', async () => {
    await open();
    const firstCard = replay.moves.findIndex((m) => m.type === 'playToTrick');
    for (let i = 0; i <= firstCard; i++) fireEvent.click(button('Forward'));
    const trick = screen.getByRole('group', { name: 'The trick' });
    expect(trick.querySelectorAll('.trick-card')).toHaveLength(1);
  });

  it("says why when the server won't send the round", async () => {
    await open(() => Promise.reject(new ApiError("That round isn't over", 404)));
    expect(screen.getByRole('alert').textContent).toBe("That round isn't over");
  });
});
