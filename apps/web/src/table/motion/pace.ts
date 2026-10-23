/**
 * Shows other players' moves one at a time, at least MIN_GAP apart, so a
 * burst of moves (a reconnect, fast bots) doesn't blur together. Your own
 * moves, and anything that isn't a move, show at once. Far behind, it jumps
 * straight to the newest, so the table never lags much.
 */
import type { PlayerView } from '@card-table/engine';
import { useEffect, useRef, useState } from 'react';
import type { GameMessage } from '../connection';
import { motionSpeed } from './animate';
import { isYours } from './plan';

/** The least time between two other players' moves on screen, in ms. */
export const MIN_GAP = 600;
/** Messages waiting past this many, it skips to the newest. */
export const MAX_BEHIND = 3;

/** Whether this message shows a move by someone else (so it waits its turn). */
export function isOthersMove(shown: PlayerView, next: PlayerView): boolean {
  if (next.log.length <= shown.log.length) return false;
  const added = next.log.slice(shown.log.length);
  return added.every((move) => !isYours(move, next.you));
}

export interface PacerOptions {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** The message on screen, and when it's time for the next one. Used by usePacedGame. */
export class Pacer {
  private queue: GameMessage[] = [];
  private shownAt = -Infinity;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private shown: GameMessage | null,
    private readonly show: (message: GameMessage) => void,
    options: PacerOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** The newest message from the server. */
  receive(message: GameMessage): void {
    const last = this.queue[this.queue.length - 1] ?? this.shown;
    if (message === last) return;
    if (!last || !isOthersMove(last.view, message.view) || this.queue.length >= MAX_BEHIND) {
      // Yours, or not a move at all (or too far behind): everything up to it shows now.
      this.queue = [];
      this.stopTimer();
      this.display(message);
      return;
    }
    this.queue.push(message);
    this.schedule();
  }

  /** Stops waiting (the table is closing). */
  stop(): void {
    this.stopTimer();
    this.queue = [];
  }

  private schedule(): void {
    if (this.timer !== null) return;
    // Fast, or with nothing moving, moves can follow each other sooner.
    const gap = motionSpeed() === 1 ? MIN_GAP : MIN_GAP / 2;
    const wait = this.shownAt + gap - this.now();
    if (wait <= 0) {
      this.next();
      return;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.next();
    }, wait);
  }

  private next(): void {
    const message = this.queue.shift();
    if (!message) return;
    this.display(message);
    if (this.queue.length > 0) this.schedule();
  }

  private display(message: GameMessage): void {
    this.shown = message;
    this.shownAt = this.now();
    this.show(message);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

/**
 * The game message to draw: the newest one, with other players' moves paced.
 * `beforeShow` runs just before each one is drawn (to note where the cards are).
 */
export function usePacedGame(
  game: GameMessage | null,
  beforeShow?: () => void,
): GameMessage | null {
  const [shown, setShown] = useState(game);
  const pacer = useRef<Pacer | null>(null);
  useEffect(() => {
    pacer.current ??= new Pacer(game, (message) => {
      beforeShow?.();
      setShown(message);
    });
    if (game) pacer.current.receive(game);
  }, [game, beforeShow]);
  useEffect(() => () => pacer.current?.stop(), []);
  return shown;
}
