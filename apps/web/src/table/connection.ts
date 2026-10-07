/**
 * One open table: a WebSocket to the server plus the latest of everything
 * it has said. React reads it with useSyncExternalStore (see useTable).
 *
 * The server is authoritative, so this keeps no game logic: it remembers
 * the last `table`, `game` and `over` messages and sends what the player
 * asks for. A dropped connection is reopened with growing delays; the
 * server then resends the current state.
 */
import type { Move } from '@card-table/engine';
import type {
  ClientMessage,
  ErrorCode,
  ServerMessage,
  TableInfo,
} from '@card-table/server/protocol';

export type GameMessage = Extract<ServerMessage, { type: 'game' }>;
export type OverMessage = Extract<ServerMessage, { type: 'over' }>;

/** A message to send, without the id (the connection adds one). */
export type Outgoing = ClientMessage extends infer M
  ? M extends unknown
    ? Omit<M, 'id'>
    : never
  : never;

export interface TableSnapshot {
  /** `reconnecting` after a drop; `closed` before start() and after close(). */
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
  table: TableInfo | null;
  game: GameMessage | null;
  over: OverMessage | null;
  /** The most recent error the server sent, for showing to the player. */
  error: { code: ErrorCode; message: string } | null;
  /** Seat that last nudged us, until dismissed. */
  nudgedBy: number | null;
}

/** An error reply from the server. */
export class TableError extends Error {
  constructor(
    readonly code: ErrorCode | 'DISCONNECTED',
    message: string,
  ) {
    super(message);
  }
}

/** The parts of the browser WebSocket this class uses, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface ConnectionOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  /** Reconnect delays in ms; the last one repeats. */
  retryDelays?: number[];
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;
const DEFAULT_DELAYS = [500, 1000, 2000, 4000, 8000, 15000];

interface Waiting {
  resolve: () => void;
  reject: (error: TableError) => void;
}

export class TableConnection {
  private snapshot: TableSnapshot = {
    status: 'closed',
    table: null,
    game: null,
    over: null,
    error: null,
    nudgedBy: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly waiting = new Map<number, Waiting>();
  private socket: SocketLike | null = null;
  private nextId = 1;
  private failures = 0;
  private timer: unknown = null;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly delays: number[];
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: ConnectionOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.delays = options.retryDelays ?? DEFAULT_DELAYS;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  // ---- for React ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): TableSnapshot => this.snapshot;

  // ---- actions ----

  /** Sends a message; resolves when the server acknowledges it, rejects with its error. */
  send(message: Outgoing): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      return Promise.reject(
        new TableError('DISCONNECTED', 'Not connected to the table. Reconnecting…'),
      );
    }
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      socket.send(JSON.stringify({ ...message, id }));
    });
  }

  /** Makes a move against the game as last seen, so a stale view is rejected rather than misapplied. */
  move(move: Move): Promise<void> {
    const seq = this.snapshot.game?.seq ?? 0;
    return this.send({ type: 'move', seq, move });
  }

  dismissError(): void {
    if (this.snapshot.error) this.update({ error: null });
  }

  dismissNudge(): void {
    if (this.snapshot.nudgedBy !== null) this.update({ nudgedBy: null });
  }

  /** Connects. After close(), starts again (React may mount a component twice). */
  start(): void {
    if (this.socket || this.timer !== null) return;
    this.update({ status: 'connecting' });
    this.open();
  }

  /** Disconnects for good, until start() is called again. */
  close(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.rejectWaiting();
    this.update({ status: 'closed' });
  }

  // ---- internals ----

  private open(): void {
    const socket = this.createSocket(this.options.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.failures = 0;
      this.update({ status: 'open' });
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) this.receive(event.data);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rejectWaiting();
      this.update({ status: 'reconnecting' });
      const delay = this.delays[Math.min(this.failures, this.delays.length - 1)] ?? 15000;
      this.failures++;
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.open();
      }, delay);
    });
  }

  private receive(data: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(data)) as ServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'table':
        this.update({ table: message.table });
        break;
      case 'game':
        // Every game message is a full view, so the newest simply replaces the last.
        this.update({ game: message });
        break;
      case 'over':
        this.update({ over: message });
        break;
      case 'nudged':
        this.update({ nudgedBy: message.by });
        break;
      case 'ack':
        this.settle(message.id, null);
        break;
      case 'error': {
        const error = new TableError(message.code, message.message);
        const handled = message.id !== null && this.settle(message.id, error);
        // Errors nobody is waiting for (e.g. while connecting) are shown to the player.
        if (!handled) this.update({ error: { code: message.code, message: message.message } });
        break;
      }
    }
  }

  /** Resolves or rejects the request with this id. Returns false if nothing was waiting. */
  private settle(id: string | number, error: TableError | null): boolean {
    if (typeof id !== 'number') return false;
    const waiting = this.waiting.get(id);
    if (!waiting) return false;
    this.waiting.delete(id);
    if (error) waiting.reject(error);
    else waiting.resolve();
    return true;
  }

  private rejectWaiting(): void {
    const error = new TableError('DISCONNECTED', 'Lost the connection to the table');
    for (const waiting of this.waiting.values()) waiting.reject(error);
    this.waiting.clear();
  }

  private update(change: Partial<TableSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}
