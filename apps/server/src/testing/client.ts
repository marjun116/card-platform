/**
 * A player's connection for tests: a real WebSocket to a listening server.
 * Keeps every raw frame it receives, so tests can check exactly what was sent.
 */
import { SESSION_COOKIE } from '../auth/session';
import type { ClientMessage, ServerMessage } from '../tables/protocol';

type GameMessage = Extract<ServerMessage, { type: 'game' }>;
type TableMessage = Extract<ServerMessage, { type: 'table' }>;
type Reply = Extract<ServerMessage, { type: 'ack' } | { type: 'error' }>;

/** A message to send, without the id (the client adds one). */
type Outgoing = ClientMessage extends infer M ? (M extends unknown ? Omit<M, 'id'> : never) : never;

interface Waiter {
  match: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
}

export class TestClient {
  /** Every frame received, exactly as sent. */
  readonly frames: string[] = [];
  readonly messages: ServerMessage[] = [];
  private waiters = new Set<Waiter>();
  private nextId = 1;
  private closed: Promise<void>;

  private constructor(
    private readonly socket: WebSocket,
    readonly name: string,
  ) {
    socket.addEventListener('message', (event: { data: unknown }) => {
      const frame = String(event.data);
      this.frames.push(frame);
      const message = JSON.parse(frame) as ServerMessage;
      this.messages.push(message);
      for (const w of this.waiters) {
        if (w.match(message)) {
          this.waiters.delete(w);
          w.resolve(message);
        }
      }
    });
    this.closed = new Promise((resolve) => socket.addEventListener('close', () => resolve()));
  }

  /** Opens a table's WebSocket as the user with this session token. */
  static async connect(
    baseUrl: string,
    code: string,
    token: string,
    name = code,
    headers: Record<string, string> = {},
  ): Promise<TestClient> {
    const url = `${baseUrl.replace(/^http/, 'ws')}/api/tables/${code}/ws`;
    const cookie = token ? { cookie: `${SESSION_COOKIE}=${token}` } : {};
    const socket = new WebSocket(url, { headers: { ...cookie, ...headers } });
    const client = new TestClient(socket, name);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error(`Couldn't connect to ${url}`)));
    });
    return client;
  }

  /** Sends a message and waits for its ack or error. */
  async request(message: Outgoing): Promise<Reply> {
    const id = this.nextId++;
    const reply = this.waitFor(
      (m): m is Reply => (m.type === 'ack' || m.type === 'error') && m.id === id,
      `reply to ${message.type}`,
    );
    this.sendRaw(JSON.stringify({ ...message, id }));
    return reply;
  }

  /** Sends a message and fails unless it's acknowledged. */
  async ok(message: Outgoing): Promise<void> {
    const reply = await this.request(message);
    if (reply.type === 'error') {
      throw new Error(`${this.name}: ${message.type} failed: ${reply.code} ${reply.message}`);
    }
  }

  sendRaw(data: string): void {
    this.socket.send(data);
  }

  /** A point in the message history, to wait for something that happens after it. */
  mark(): number {
    return this.messages.length;
  }

  /** The first message (already received, from `from` on, or still to come) that matches. */
  waitFor<T extends ServerMessage>(
    match: (m: ServerMessage) => m is T,
    what: string,
    from?: number,
    timeoutMs?: number,
  ): Promise<T>;
  waitFor(
    match: (m: ServerMessage) => boolean,
    what: string,
    from?: number,
    timeoutMs?: number,
  ): Promise<ServerMessage>;
  waitFor(
    match: (m: ServerMessage) => boolean,
    what: string,
    from = 0,
    timeoutMs = 5000,
  ): Promise<ServerMessage> {
    const found = this.messages.slice(from).find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { match, resolve };
      this.waiters.add(waiter);
      setTimeout(() => {
        if (this.waiters.delete(waiter)) {
          reject(new Error(`${this.name} timed out waiting for ${what}`));
        }
      }, timeoutMs).unref();
    });
  }

  /** Waits for this player's view after `seq` moves. */
  game(seq: number): Promise<GameMessage> {
    return this.waitFor((m): m is GameMessage => m.type === 'game' && m.seq === seq, `game ${seq}`);
  }

  /** The most recent view of the game received. */
  get lastGame(): GameMessage | undefined {
    return this.messages.findLast((m): m is GameMessage => m.type === 'game');
  }

  get lastTable(): TableMessage['table'] | undefined {
    return this.messages.findLast((m): m is TableMessage => m.type === 'table')?.table;
  }

  /** Waits for a lobby update that matches, received after `from` (see `mark`). */
  table(
    match: (t: TableMessage['table']) => boolean,
    what = 'table update',
    from = 0,
  ): Promise<TableMessage> {
    return this.waitFor((m): m is TableMessage => m.type === 'table' && match(m.table), what, from);
  }

  async close(): Promise<void> {
    this.socket.close();
    await this.closed;
  }
}
