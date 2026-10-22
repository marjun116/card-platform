import type { PublicMove } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { createGame, gameMessage, spades } from '../../test/games';
import type { GameMessage } from '../connection';
import { isOthersMove, MAX_BEHIND, MIN_GAP, Pacer } from './pace';

// Seat 0 is looking. Only who moved matters here, so the moves are all passes.
const start = gameMessage(createGame(spades, {}, 4, 'pace'), 0);

/** The starting message with these seats' moves added to the log. */
function after(...seats: number[]): GameMessage {
  const added: PublicMove[] = seats.map((player) => ({ player, type: 'passBid' }));
  return {
    ...start,
    seq: start.seq + seats.length,
    view: { ...start.view, log: [...start.view.log, ...added] },
  };
}

/** A pacer with a clock and timers the test moves by hand. */
function setup(first: GameMessage = start) {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  const shown: GameMessage[] = [];
  const pacer = new Pacer(first, (m) => shown.push(m), {
    now: () => time,
    setTimer: (run, ms) => {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      timers = timers.filter((t) => t !== handle);
    },
  });
  const advance = (ms: number) => {
    time += ms;
    for (const timer of timers.filter((t) => t.at <= time)) {
      timers = timers.filter((t) => t !== timer);
      timer.run();
    }
  };
  return { pacer, shown, advance };
}

describe('isOthersMove', () => {
  it('is true only when every new move is by someone else', () => {
    expect(isOthersMove(start.view, after(1).view)).toBe(true);
    expect(isOthersMove(start.view, after(1, 2).view)).toBe(true);
    expect(isOthersMove(start.view, after(1, 0).view)).toBe(false);
    expect(isOthersMove(start.view, start.view)).toBe(false);
  });

  it("counts a move made for you (bridge's dummy) as yours", () => {
    const made: GameMessage = {
      ...start,
      view: { ...start.view, log: [{ player: 2, by: 0, type: 'passBid' }] },
    };
    expect(isOthersMove(start.view, made.view)).toBe(false);
  });
});

describe('Pacer', () => {
  it("shows another player's move at once, and the next one after a gap", () => {
    const { pacer, shown, advance } = setup();
    const one = after(1);
    const two = after(1, 2);
    pacer.receive(one);
    pacer.receive(two);
    expect(shown).toEqual([one]);
    advance(MIN_GAP - 1);
    expect(shown).toEqual([one]);
    advance(1);
    expect(shown).toEqual([one, two]);
    // One that arrives long after the last shows straight away.
    advance(5000);
    const three = after(1, 2, 3);
    pacer.receive(three);
    expect(shown).toEqual([one, two, three]);
  });

  it('shows your own move at once, skipping what was waiting before it', () => {
    const { pacer, shown } = setup();
    const one = after(1);
    const yours = after(1, 2, 3, 0);
    pacer.receive(one);
    pacer.receive(after(1, 2));
    pacer.receive(yours);
    expect(shown).toEqual([one, yours]);
  });

  it('jumps to the newest when it falls too far behind', () => {
    const { pacer, shown } = setup();
    const waiting = Array.from({ length: MAX_BEHIND + 1 }, (_, i) =>
      after(...Array<number>(i + 2).fill(1)),
    );
    pacer.receive(after(1));
    for (const message of waiting) pacer.receive(message);
    expect(shown).toEqual([after(1), waiting[waiting.length - 1]]);
  });

  it('shows anything that is not a move at once', () => {
    const { pacer, shown } = setup();
    const same = { ...start, toAct: [] };
    pacer.receive(same);
    expect(shown).toEqual([same]);
  });

  it('stops showing once stopped', () => {
    const { pacer, shown, advance } = setup();
    pacer.receive(after(1));
    pacer.receive(after(1, 2));
    pacer.stop();
    advance(MIN_GAP * 2);
    expect(shown).toEqual([after(1)]);
  });
});
