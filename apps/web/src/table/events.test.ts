import { applyMove, type GameState, getLegalMoves, viewFor } from '@card-table/engine';
import { withZones } from '@card-table/engine/testing';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { counting, createGame, spades } from '../test/games';
import { EVENT_TIME, eventSeat, newEvents, spokenWords, useTableEvents } from './events';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NAMES = ['Arjun', 'Ana', 'Sam', 'Raj'];
const names = (seat: number) => NAMES[seat] ?? `Seat ${seat + 1}`;

/** Spades, and the same game after the first player has bid `value`. */
function bidding(value: number | string = 3) {
  const before = createGame(spades, {}, 4, 'events-bid');
  const seat = before.cursor.current;
  const bid = getLegalMoves(before, seat).find((m) => m.type === 'bid' && m.value === value);
  if (!bid) throw new Error(`no bid of ${value}`);
  return { before, after: applyMove(before, bid), seat };
}

/** The counting game, before and after a card that scores a pair. */
function pairScored() {
  const start = createGame(counting, {}, 2, 'events-count');
  const first = start.cursor.current;
  const other = 1 - first;
  const dealt = withZones(
    start,
    { [`hand@${first}`]: ['5H', '6H', '7H'], [`hand@${other}`]: ['5C', '6D', 'JS'] },
    'stock',
  );
  const play = (s: GameState, player: number, card: string) =>
    applyMove(s, { player, type: 'play', card, to: 'pile' });
  const before = play(dealt, first, '5H.0');
  return { before, after: play(before, other, '5C.0'), first, other };
}

describe('newEvents', () => {
  it('says a bid at the seat that made it', () => {
    const { before, after, seat } = bidding(3);
    expect(newEvents(viewFor(before, 0), viewFor(after, 0), names)).toEqual([
      { kind: 'speech', seat, text: 'Bid 3' },
    ]);
  });

  it('shows nothing for the view the table opens on', () => {
    const { after } = bidding(3);
    expect(newEvents(null, viewFor(after, 0), names)).toEqual([]);
  });

  it('shows nothing when nothing new happened', () => {
    const { after } = bidding(3);
    expect(newEvents(viewFor(after, 0), viewFor(after, 0), names)).toEqual([]);
  });

  it('floats up points scored during play, with their label', () => {
    const { before, after, first, other } = pairScored();
    const events = newEvents(viewFor(before, first), viewFor(after, first), names);
    expect(events).toEqual([{ kind: 'points', seat: other, points: 2, label: 'Pair' }]);
  });

  it('has no bubble for playing a card', () => {
    const { before, after, first } = pairScored();
    const events = newEvents(viewFor(before, first), viewFor(after, first), names);
    expect(events.some((e) => e.kind === 'speech')).toBe(false);
  });
});

describe('newEvents: big moments', () => {
  it('shows a banner for each new moment, with whose it is', () => {
    const { before, after } = bidding(3);
    const view = viewFor(after, 0);
    const moment = { round: 1, at: 1, label: 'Euchred!', player: null, team: 1 };
    const events = newEvents(viewFor(before, 0), { ...view, moments: [moment] }, names);
    expect(events).toContainEqual({ kind: 'moment', who: 'Team 2 (Ana & Raj)', label: 'Euchred!' });
    expect(events.find((e) => e.kind === 'moment' && eventSeat(e) === null)).toBeDefined();
  });

  it('shows none for moments that were already there', () => {
    const { after } = bidding(3);
    const view = viewFor(after, 0);
    const withMoment = {
      ...view,
      moments: [{ round: 1, at: 1, label: 'Set!', player: null, team: null }],
    };
    expect(newEvents(withMoment, withMoment, names)).toEqual([]);
  });
});

describe('spokenWords', () => {
  const view = { ...viewFor(createGame(spades, {}, 4, 'words'), 0) };

  it('uses the words for each kind of decision said out loud', () => {
    expect(spokenWords({ player: 1, type: 'bid', value: 4 }, view, names)).toBe('Bid 4');
    expect(spokenWords({ player: 1, type: 'bid', value: 'nil' }, view, names)).toBe('Nil');
    expect(spokenWords({ player: 1, type: 'passBid' }, view, names)).toBe('Pass');
    expect(spokenWords({ player: 1, type: 'declareTrump', suit: 'hearts' }, view, names)).toBe(
      '♥ Hearts are trump',
    );
  });

  it("uses the game's own words for bids and choices", () => {
    const own = { ...view, bidLabels: { '11': '1♣' }, choiceLabels: { orderUp: 'Order it up' } };
    expect(spokenWords({ player: 1, type: 'bid', value: 11 }, own, names)).toBe('1♣');
    expect(spokenWords({ player: 1, type: 'choose', value: 'orderUp' }, own, names)).toBe(
      'Order it up',
    );
  });

  it('says nothing for other moves', () => {
    expect(spokenWords({ player: 1, type: 'draw', from: 'stock' }, view, names)).toBeNull();
    expect(spokenWords({ player: 1, type: 'pass', hidden: true }, view, names)).toBeNull();
  });
});

describe('useTableEvents', () => {
  it('shows an event for its time, then lets it go', () => {
    vi.useFakeTimers();
    const { before, after, seat } = bidding(3);
    const { result, rerender } = renderHook(({ view }) => useTableEvents(view, names), {
      initialProps: { view: viewFor(before, 0) },
    });
    expect(result.current).toEqual([]);

    rerender({ view: viewFor(after, 0) });
    expect(result.current.map((s) => s.event)).toEqual([{ kind: 'speech', seat, text: 'Bid 3' }]);

    act(() => {
      vi.advanceTimersByTime(EVENT_TIME.speech + 10);
    });
    expect(result.current).toEqual([]);
  });

  it("replaces a seat's bubble with its newer one", () => {
    vi.useFakeTimers();
    const { before, after, seat } = bidding(3);
    const { result, rerender } = renderHook(({ view }) => useTableEvents(view, names), {
      initialProps: { view: viewFor(before, 0) },
    });
    rerender({ view: viewFor(after, 0) });
    // The same seat speaks again (a made-up later view with a second bid).
    const later = viewFor(after, 0);
    rerender({
      view: { ...later, log: [...later.log, { player: seat, type: 'bid', value: 5 }] },
    });
    expect(result.current.map((s) => s.event)).toEqual([{ kind: 'speech', seat, text: 'Bid 5' }]);
  });

  it('floats points scored together one after another', () => {
    const { before, after, first, other } = pairScored();
    const view = viewFor(after, first);
    const extra = { ...view.scoreEvents[view.scoreEvents.length - 1]!, label: 'Fifteen' };
    const { result, rerender } = renderHook(({ v }) => useTableEvents(v, names), {
      initialProps: { v: viewFor(before, first) },
    });
    rerender({ v: { ...view, scoreEvents: [...view.scoreEvents, extra] } });
    expect(result.current.map((s) => [eventSeat(s.event), s.delay])).toEqual([
      [other, 0],
      [other, 300],
    ]);
  });
});
