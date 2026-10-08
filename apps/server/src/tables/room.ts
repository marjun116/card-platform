/**
 * A table that someone has open: its game state in memory, its connections,
 * and the rules for every message. Messages are handled one at a time, in
 * order. Every change is saved before anyone is told about it.
 *
 * Only `sendGame` sends game state, and it sends each seat nothing but
 * viewFor(state, thatSeat).
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  getScores,
  IllegalMoveError,
  isGameOver,
  type Move,
  playersToAct,
  replay,
  teamsFor,
  viewFor,
} from '@card-table/engine';
import type { WebSocket } from '@fastify/websocket';
import type { Deps } from '../deps';
import { ConflictError, type GameVersion, type Table, type User } from '../store/types';
import type { ClientMessage, ErrorCode, MessageId, ServerMessage, TableInfo } from './protocol';

/** Thrown while handling a message; becomes an `error` reply. */
export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface Connection {
  socket: WebSocket;
  userId: string;
}

export class TableRoom {
  private connections = new Set<Connection>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly deps: Deps,
    private table: Table,
    private readonly game: GameVersion,
    /** null until the game starts. */
    private state: GameState | null,
  ) {}

  /** Loads a table, rebuilding its game from the seed and the saved moves. */
  static async load(deps: Deps, table: Table, game: GameVersion): Promise<TableRoom> {
    let state: GameState | null = null;
    if (table.startedAt) {
      const moves = await deps.store.listMoves(table.id);
      state = replay(game.file, table.options, table.playerCount, table.seed, moves);
    }
    return new TableRoom(deps, table, game, state);
  }

  get tableId(): string {
    return this.table.id;
  }

  get isEmpty(): boolean {
    return this.connections.size === 0;
  }

  isConnected(userId: string): boolean {
    return [...this.connections].some((c) => c.userId === userId);
  }

  /** Runs `work` after everything already queued. */
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Adds a connection and sends it the table and, to a seated player, their
   * view. Returns false if the room was closed first (see `closeIfEmpty`);
   * the caller should then open a fresh room.
   */
  connect(socket: WebSocket, user: User): Promise<boolean> {
    return this.enqueue(() => {
      if (this.closed) return Promise.resolve(false);
      const connection = { socket, userId: user.id };
      this.connections.add(connection);
      this.broadcastTable();
      const seat = this.seatOf(user.id);
      if (seat !== null) {
        this.sendGame(seat, [connection]);
        this.sendOver([connection]);
      }
      return Promise.resolve(true);
    });
  }

  disconnect(socket: WebSocket): Promise<void> {
    return this.enqueue(() => {
      for (const c of this.connections) if (c.socket === socket) this.connections.delete(c);
      this.broadcastTable();
      return Promise.resolve();
    });
  }

  /** Closes the room if nobody is connected. A closed room accepts no more connections. */
  closeIfEmpty(): Promise<boolean> {
    return this.enqueue(() => {
      if (this.connections.size === 0) this.closed = true;
      return Promise.resolve(this.closed);
    });
  }

  /** Handles one message from a connected user, replying with ack or error. */
  handle(socket: WebSocket, user: User, message: ClientMessage): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.dispatch(user, message);
        send(socket, { type: 'ack', id: message.id });
      } catch (error) {
        sendError(socket, message.id, error);
      }
    });
  }

  info(): TableInfo {
    return tableInfo(this.table, this.game, (userId) => this.isConnected(userId));
  }

  // ---- message handling ----

  private async dispatch(user: User, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'sit':
        return this.sit(user, message.seat);
      case 'stand':
        return this.stand(user);
      case 'start':
        return this.start(user);
      case 'move':
        return this.move(user, message.seq, message.move);
      case 'nudge':
        return this.nudge(user, message.seat);
      case 'pause':
        return this.setStatus(user, 'playing', 'paused');
      case 'resume':
        return this.setStatus(user, 'paused', 'playing');
      case 'end':
        return this.end(user);
      case 'freeSeat':
        return this.freeSeat(user, message.seat);
    }
  }

  private async sit(user: User, seat: number): Promise<void> {
    const { status } = this.table;
    // Mid-game, only seats the host has freed are empty.
    if (status !== 'lobby' && status !== 'playing' && status !== 'paused') {
      throw new RoomError('WRONG_STATUS', 'This table has ended');
    }
    if (seat >= this.table.playerCount) throw new RoomError('BAD_SEAT', `There is no seat ${seat}`);
    if (this.seatOf(user.id) !== null) {
      throw new RoomError('ALREADY_SEATED', 'You already have a seat at this table');
    }
    if (this.table.seats.some((s) => s.seat === seat)) {
      throw new RoomError('SEAT_TAKEN', 'That seat is taken');
    }
    try {
      await this.deps.store.takeSeat(this.table.id, seat, user.id);
    } catch (error) {
      if (error instanceof ConflictError) throw new RoomError('SEAT_TAKEN', 'That seat is taken');
      throw error;
    }
    await this.reloadTable();
    this.broadcastTable();
    if (this.state) this.sendGame(seat);
  }

  private async stand(user: User): Promise<void> {
    this.requireStatus('lobby', 'You can only leave your seat before the game starts');
    const seat = this.requireSeat(user);
    await this.deps.store.leaveSeat(this.table.id, seat);
    await this.reloadTable();
    this.broadcastTable();
  }

  private async start(user: User): Promise<void> {
    this.requireHost(user);
    this.requireStatus('lobby', 'The game has already started');
    if (this.table.seats.length < this.table.playerCount) {
      throw new RoomError('SEATS_EMPTY', 'Every seat must be filled to start');
    }
    const { table } = this;
    const state = createGame(this.game.file, table.options, table.playerCount, table.seed);
    const now = this.deps.now();
    this.table = await this.deps.store.updateTable(table.id, {
      status: 'playing',
      startedAt: now,
      toAct: playersToAct(state),
      turnSince: now,
    });
    this.state = state;
    this.broadcastTable();
    this.sendGameToAll();
  }

  private async move(user: User, seq: number, requested: Omit<Move, 'player'>): Promise<void> {
    this.requireStatus(
      'playing',
      this.table.status === 'paused' ? 'The game is paused' : "The game isn't being played",
    );
    const seat = this.requireSeat(user);
    const state = this.state;
    if (!state) throw new RoomError('WRONG_STATUS', "The game hasn't started");
    // Arranging your hand only touches your own groups, so it can't go stale: it's
    // often done while other players are moving.
    const free = requested.type === 'arrange' || requested.type === 'sortHand';
    if (requested.type !== 'arrange' && seq !== state.log.length) {
      throw new RoomError(
        'STALE_SEQ',
        `You've seen ${seq} moves but there have been ${state.log.length}`,
      );
    }

    // Always the sender's own seat, whatever the message said.
    const move = { ...requested, player: seat } as Move;
    if (isBlind(state, seat) && namesCards(move)) {
      // Otherwise a blind player could find out what they hold by guessing card ids.
      throw new RoomError('ILLEGAL_MOVE', 'Look at your hand first');
    }
    let next: GameState;
    try {
      next = applyMove(state, move);
    } catch (error) {
      if (error instanceof IllegalMoveError) throw new RoomError('ILLEGAL_MOVE', error.message);
      throw error;
    }

    const now = this.deps.now();
    const over = isGameOver(next);
    // The move exactly as the engine accepted it.
    const saved = next.log[next.log.length - 1] as Move;
    await this.deps.store.recordMove(this.table.id, state.log.length, saved, {
      toAct: playersToAct(next),
      // Arranging doesn't change whose turn it is, so the idle timer keeps running.
      turnSince: over ? null : free ? this.table.turnSince : now,
      ...(over && {
        finished: { endedAt: now, result: { winners: [...next.winners], scores: getScores(next) } },
      }),
    });
    this.state = next;
    await this.reloadTable();

    this.sendGameToAll();
    if (over) {
      this.broadcastTable();
      this.sendOver();
    }
  }

  private async nudge(user: User, target: number): Promise<void> {
    this.requireStatus('playing', 'Nudges only work while the game is being played');
    const from = this.requireSeat(user);
    const seat = this.table.seats.find((s) => s.seat === target);
    if (!seat || target === from || !this.table.toAct.includes(target)) {
      throw new RoomError('NOT_THEIR_TURN', "It isn't that player's turn");
    }
    const now = this.deps.now();
    if (
      seat.lastNudgeAt &&
      now.getTime() - seat.lastNudgeAt.getTime() < this.deps.config.nudgeCooldownMs
    ) {
      throw new RoomError('RATE_LIMITED', 'That player was nudged a moment ago');
    }
    await this.deps.store.setNudged(this.table.id, target, now);
    await this.reloadTable();
    await this.deps.notifier.notify({
      tableId: this.table.id,
      seat: target,
      userId: seat.userId,
      reason: 'manual',
    });
    for (const c of this.connections) {
      if (c.userId === seat.userId) send(c.socket, { type: 'nudged', by: from });
    }
  }

  private async setStatus(
    user: User,
    from: 'playing' | 'paused',
    to: 'playing' | 'paused',
  ): Promise<void> {
    this.requireHost(user);
    this.requireStatus(
      from,
      from === 'playing' ? "The game isn't being played" : "The game isn't paused",
    );
    this.table = await this.deps.store.updateTable(this.table.id, { status: to });
    this.broadcastTable();
    // Legal moves are hidden while paused, so everyone needs a fresh view.
    this.sendGameToAll();
  }

  private async end(user: User): Promise<void> {
    this.requireHost(user);
    const { status } = this.table;
    if (status === 'finished' || status === 'abandoned') {
      throw new RoomError('WRONG_STATUS', 'This table has already ended');
    }
    this.table = await this.deps.store.updateTable(this.table.id, {
      status: 'abandoned',
      endedAt: this.deps.now(),
      toAct: [],
      turnSince: null,
    });
    this.broadcastTable();
    this.sendGameToAll();
  }

  private async freeSeat(user: User, seat: number): Promise<void> {
    this.requireHost(user);
    const taken = this.table.seats.find((s) => s.seat === seat);
    if (!taken) throw new RoomError('BAD_SEAT', 'That seat is already empty');
    if (this.isConnected(taken.userId)) {
      throw new RoomError('PLAYER_CONNECTED', 'That player is still connected');
    }
    await this.deps.store.leaveSeat(this.table.id, seat);
    await this.reloadTable();
    this.broadcastTable();
  }

  // ---- checks ----

  private requireHost(user: User): void {
    if (user.id !== this.table.hostId) throw new RoomError('NOT_HOST', 'Only the host can do that');
  }

  private requireStatus(status: Table['status'], message: string): void {
    if (this.table.status !== status) throw new RoomError('WRONG_STATUS', message);
  }

  private requireSeat(user: User): number {
    const seat = this.seatOf(user.id);
    if (seat === null) throw new RoomError('NOT_SEATED', "You don't have a seat at this table");
    return seat;
  }

  private seatOf(userId: string): number | null {
    return this.table.seats.find((s) => s.userId === userId)?.seat ?? null;
  }

  private async reloadTable(): Promise<void> {
    const table = await this.deps.store.getTable(this.table.id);
    if (!table) throw new Error(`Table ${this.table.id} disappeared`);
    this.table = table;
  }

  // ---- sending ----

  private broadcastTable(): void {
    const message: ServerMessage = { type: 'table', table: this.info() };
    for (const c of this.connections) send(c.socket, message);
  }

  private sendGameToAll(): void {
    for (const s of this.table.seats) this.sendGame(s.seat);
  }

  /** Sends one seat its own view of the game. The only place game state leaves the server. */
  private sendGame(seat: number, to: Iterable<Connection> = this.connections): void {
    const state = this.state;
    const userId = this.table.seats.find((s) => s.seat === seat)?.userId;
    if (!state || !userId) return;
    const message: ServerMessage = {
      type: 'game',
      seq: state.log.length,
      view: viewFor(state, seat),
      legalMoves: this.table.status === 'playing' ? legalMovesFor(state, seat) : [],
      toAct: this.table.status === 'playing' ? playersToAct(state) : [],
    };
    for (const c of to) if (c.userId === userId) send(c.socket, message);
  }

  private sendOver(to: Iterable<Connection> = this.connections): void {
    const state = this.state;
    if (!state || !isGameOver(state)) return;
    const message: ServerMessage = {
      type: 'over',
      winners: [...state.winners],
      scores: getScores(state),
    };
    for (const c of to) if (this.seatOf(c.userId) !== null) send(c.socket, message);
  }
}

/**
 * A player who hasn't looked at a face-down hand (blind nil) can't see their
 * own cards, so they mustn't be told which cards they could play either.
 */
function isBlind(state: GameState, seat: number): boolean {
  return state.lookRequired && state.players[seat]?.hasLookedAtHand === false;
}

const namesCards = (move: Move) => 'card' in move || 'cards' in move || 'groups' in move;

/** The legal moves a player may be told about: none that name cards they can't see. */
function legalMovesFor(state: GameState, seat: number): Move[] {
  const moves = getLegalMoves(state, seat);
  return isBlind(state, seat) ? moves.filter((m) => !namesCards(m)) : moves;
}

/** Lobby info for a table: seats, options and status, never any cards. */
export function tableInfo(
  table: Table,
  game: GameVersion,
  isConnected: (userId: string) => boolean,
): TableInfo {
  return {
    code: table.inviteCode,
    game: { slug: game.slug, name: game.name, version: game.version },
    options: table.options,
    playerCount: table.playerCount,
    teams: teamsFor(game.file, table.playerCount),
    status: table.status,
    hostId: table.hostId,
    seats: Array.from({ length: table.playerCount }, (_, seat) => {
      const taken = table.seats.find((s) => s.seat === seat);
      return {
        seat,
        user: taken ? { id: taken.userId, displayName: taken.displayName } : null,
        connected: taken ? isConnected(taken.userId) : false,
      };
    }),
  };
}

const OPEN = 1;

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
}

export function sendError(socket: WebSocket, id: MessageId | null, error: unknown): void {
  if (error instanceof RoomError) {
    send(socket, { type: 'error', id, code: error.code, message: error.message });
  } else {
    console.error(error);
    send(socket, {
      type: 'error',
      id,
      code: 'SERVER_ERROR',
      message: 'Something went wrong on the server',
    });
  }
}
