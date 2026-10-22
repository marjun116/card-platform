/**
 * What just happened at the table, to show for a moment: a bid said out loud
 * at a seat, points floating up from a player. Worked out by comparing the
 * view on screen with the one before it, so it follows the pacing of other
 * players' moves, and opening a table never replays what happened before you
 * came. Generic: it looks at move types and score events, never at the game.
 */
import type { PlayerView, PublicMove } from '@card-table/engine';
import { useEffect, useRef, useState } from 'react';
import { bidLabel, moveLabel, type SeatNames } from './describe';
import { humanize } from './zones';

export type TableEvent =
  /** A decision said out loud (a bid, a pass, naming trump): a speech bubble at the seat. */
  | { kind: 'speech'; seat: number; text: string }
  /** Points scored during play, floating up from the player. */
  | { kind: 'points'; seat: number; points: number; label: string | null };

/** How long each kind of event stays on screen, in ms. */
export const EVENT_TIME: Record<TableEvent['kind'], number> = {
  speech: 2500,
  points: 1600,
};

/** The words for a decision a player says out loud, or null for any other move. */
export function spokenWords(move: PublicMove, view: PlayerView, names: SeatNames): string | null {
  if ('hidden' in move) return null;
  switch (move.type) {
    case 'bid':
      // "Nil" and "1♣" say themselves; a bare number reads better as "Bid 3".
      return typeof move.value === 'number' && !Object.hasOwn(view.bidLabels, String(move.value))
        ? `Bid ${move.value}`
        : bidLabel(move.value, view.bidLabels);
    case 'passBid':
    case 'declareTrump':
    case 'choose':
      return moveLabel(move, names, view.choiceLabels, view.bidLabels);
    default:
      return null;
  }
}

/** Everything that happened between two views, oldest first. Nothing on the first view. */
export function newEvents(
  before: PlayerView | null,
  after: PlayerView,
  names: SeatNames,
): TableEvent[] {
  // A different game, or a log that got shorter: start afresh rather than guess.
  if (!before || before.game !== after.game || after.log.length < before.log.length) return [];
  const events: TableEvent[] = [];
  for (const move of after.log.slice(before.log.length)) {
    const text = spokenWords(move, after, names);
    if (text !== null) events.push({ kind: 'speech', seat: move.player, text });
  }
  if (after.scoreEvents.length >= before.scoreEvents.length) {
    for (const scored of after.scoreEvents.slice(before.scoreEvents.length)) {
      if (scored.points === 0) continue;
      events.push({
        kind: 'points',
        seat: scored.player,
        points: scored.points,
        label: scored.label ?? (scored.into ? humanize(scored.into) : null),
      });
    }
  }
  return events;
}

export interface ShownEvent {
  /** Unique while the table is open, for React keys and to restart animations. */
  id: number;
  event: TableEvent;
  /** How long it waits before showing, in ms: points scored together float up in turn. */
  delay: number;
  /** When it goes (Date.now() time). */
  until: number;
}

/** The gap between points scored together at one seat, in ms. */
const STAGGER = 300;

/**
 * The events on screen right now. Each new view adds what happened since the
 * last one, and each event goes again after its time (see EVENT_TIME). A
 * newer bubble at the same seat replaces the older one.
 */
export function useTableEvents(view: PlayerView, names: SeatNames): ShownEvent[] {
  const [shown, setShown] = useState<ShownEvent[]>([]);
  const before = useRef<PlayerView | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    const events = newEvents(before.current, view, names);
    before.current = view;
    if (events.length === 0) return;
    const now = Date.now();
    const waiting = new Map<number, number>();
    const added = events.map((event) => {
      const queued = event.kind === 'points' ? (waiting.get(event.seat) ?? 0) : 0;
      if (event.kind === 'points') waiting.set(event.seat, queued + 1);
      const delay = queued * STAGGER;
      return { id: nextId.current++, event, delay, until: now + delay + EVENT_TIME[event.kind] };
    });
    // Only the newest bubble at each seat is said (older ones, and two at once after a
    // reconnect, give way).
    const saidLater = (item: ShownEvent, later: ShownEvent[]) =>
      item.event.kind === 'speech' &&
      later.some((b) => b.event.kind === 'speech' && b.event.seat === item.event.seat);
    setShown((current) => [
      ...current.filter((item) => !saidLater(item, added)),
      ...added.filter((item, i) => !saidLater(item, added.slice(i + 1))),
    ]);
  }, [view, names]);

  // A timer for the next event to go; it starts again whenever the list changes.
  useEffect(() => {
    if (shown.length === 0) return;
    const next = Math.min(...shown.map((item) => item.until));
    const timer = setTimeout(
      () => setShown((current) => current.filter((item) => item.until > Date.now())),
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [shown]);

  return shown;
}
