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
  askBot,
  type Bot,
  createGame,
  type GameState,
  getLegalMoves,
  getScores,
  IllegalMoveError,
  isGameOver,
  type Move,
  playersToAct,
  randomInt,
  replay,
  seedRng,
  teamsFor,
  viewFor,
} from '@card-table/engine';
import { builtInBots } from '@card-table/games';
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
  /** The next bot move, waiting out the pause before bots play. */
  private botTimer: NodeJS.Timeout | null = null;
  /**
   * Players looking at the scores of the round that just ended (see TableInfo).
   * Not saved: after a restart nobody has the scores open, so bots carry on.
   */
  private readingScores = new Set<number>();

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
    const room = new TableRoom(deps, table, game, state);
    // Bots due to move (say after a restart) carry on.
    room.scheduleBots();
    return room;
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
      let userId: string | null = null;
      for (const c of this.connections) {
        if (c.socket !== socket) continue;
        this.connections.delete(c);
        userId = c.userId;
      }
      // Someone who has left the table isn't looking at the scores any more.
      const seat = userId === null || this.isConnected(userId) ? null : this.seatOf(userId);
      if (seat !== null && this.readingScores.delete(seat)) this.scheduleBots();
      this.broadcastTable();
      return Promise.resolve();
    });
  }

  /**
   * Deletes the table (after anything already queued, so no move is half saved),
   * tells everyone connected and closes the room for good.
   */
  delete(): Promise<void> {
    return this.enqueue(async () => {
      this.closed = true;
      if (this.botTimer) clearTimeout(this.botTimer);
      this.botTimer = null;
      await this.deps.store.deleteTable(this.table.id);
      for (const c of this.connections) {
        send(c.socket, { type: 'deleted' });
        c.socket.close(1000, 'Table deleted');
      }
      this.connections.clear();
    });
  }

  /** Closes the room if nobody is connected. A closed room accepts no more connections. */
  closeIfEmpty(): Promise<boolean> {
    return this.enqueue(() => {
      if (this.connections.size === 0) {
        this.closed = true;
        // Bots wait for someone to open the table again.
        if (this.botTimer) clearTimeout(this.botTimer);
        this.botTimer = null;
      }
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
    return tableInfo(
      this.table,
      this.game,
      (userId) => this.isConnected(userId),
      [...this.readingScores].sort((a, b) => a - b),
    );
  }

  // ---- bots ----

  /** The bot for this table's game, if bots can play it (built-in games only). */
  private get bot(): Bot | null {
    return botFor(this.game);
  }

  /** A bot seat whose turn it is, if any. None while someone is reading the round's scores. */
  private botToAct(): number | null {
    if (this.readingScores.size > 0) return null;
    const state = this.state;
    if (!state || this.table.status !== 'playing' || this.closed) return null;
    const bots = new Set(this.table.seats.filter((s) => s.isBot).map((s) => s.seat));
    return playersToAct(state).find((seat) => bots.has(seat)) ?? null;
  }

  /** Lets a bot whose turn it is move after the pause (see Config.botMoveDelayMs). */
  private scheduleBots(): void {
    if (this.botTimer || this.botToAct() === null) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.enqueue(() => this.botTurn()).catch((error: unknown) => console.error(error));
    }, this.deps.config.botMoveDelayMs);
    this.botTimer.unref();
  }

  /**
   * One bot move. The bot sees only its own view and legal moves; its move goes
   * through the same path as a player's. Arranging a hand is free, so a bot
   * that arranges its cards then moves straight away.
   */
  private async botTurn(): Promise<void> {
    const bot = this.bot;
    for (let arranged = 0; arranged < 5; arranged++) {
      const seat = this.botToAct();
      const state = this.state;
      if (seat === null || !state || !bot) return;
      const legal = getLegalMoves(state, seat);
      if (legal.length === 0) return;
      // Seeded by the table and the move number, so a bot's choices can be repeated.
      const rng = seedRng(`${this.table.seed}:bot:${state.log.length}`);
      const move = askBot(bot, state, legal, (n) => randomInt(rng, n));
      try {
        await this.play(move, state);
      } catch (error) {
        // A bot should never make an illegal move, and a game that can't go on (a
        // stalemate the engine stops) can't be helped by trying again: log it and wait
        // for the players.
        console.error(`Bot in seat ${seat} at table ${this.table.id} couldn't move:`, error);
        return;
      }
      if (move.type !== 'arrange') return;
    }
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
      case 'addBot':
        return this.addBot(user, message.seat);
      case 'removeBot':
        return this.removeBot(user, message.seat);
      case 'replaceWithBot':
        return this.replaceWithBot(user, message.seat);
      case 'roundSeen':
        return this.roundSeen(user);
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
    this.scheduleBots();
  }

  private async move(
    user: User,
    seq: number,
    requested: Omit<Move, 'player'> & { player?: number },
  ): Promise<void> {
    this.requireStatus(
      'playing',
      this.table.status === 'paused' ? 'The game is paused' : "The game isn't being played",
    );
    const seat = this.requireSeat(user);
    const state = this.state;
    if (!state) throw new RoomError('WRONG_STATUS', "The game hasn't started");
    // Arranging your hand only touches your own groups, so it can't go stale: it's
    // often done while other players are moving.
    if (requested.type !== 'arrange' && seq !== state.log.length) {
      throw new RoomError(
        'STALE_SEQ',
        `You've seen ${seq} moves but there have been ${state.log.length}`,
      );
    }

    // The sender's own seat, whatever the message said: as the player, or as `by` when
    // playing for another seat (which the engine only allows from the seat in control).
    const { by: claimed, player: forSeat, ...rest } = requested;
    const move = (
      claimed !== undefined && forSeat !== undefined
        ? { ...rest, player: forSeat, by: seat }
        : { ...rest, player: seat }
    ) as Move;
    if (isBlind(state, seat) && namesCards(move)) {
      // Otherwise a blind player could find out what they hold by guessing card ids.
      throw new RoomError('ILLEGAL_MOVE', 'Look at your hand first');
    }
    await this.play(move, state);
  }

  /**
   * Applies a move (a player's, or a bot's), saves it and tells everyone; then
   * lets any bot due to move take its turn.
   */
  private async play(move: Move, state: GameState): Promise<void> {
    // Arranging your hand doesn't change whose turn it is.
    const free = move.type === 'arrange' || move.type === 'sortHand';
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

    // A round just ended: everyone at the table is shown its scores, and the bots wait
    // until they've all closed them (see roundSeen).
    const roundEnded = next.history.length > state.history.length;
    if (roundEnded && !over) {
      this.readingScores = new Set(
        this.table.seats.filter((s) => !s.isBot && this.isConnected(s.userId)).map((s) => s.seat),
      );
    }

    this.sendGameToAll();
    if (over || this.readingScores.size > 0) this.broadcastTable();
    if (over) this.sendOver();
    this.scheduleBots();
  }

  /** A player closed the round's scores; once everyone has, the bots carry on. */
  private roundSeen(user: User): Promise<void> {
    const seat = this.requireSeat(user);
    if (this.readingScores.delete(seat)) {
      this.broadcastTable();
      this.scheduleBots();
    }
    return Promise.resolve();
  }

  private async nudge(user: User, target: number): Promise<void> {
    this.requireStatus('playing', 'Nudges only work while the game is being played');
    const from = this.requireSeat(user);
    const seat = this.table.seats.find((s) => s.seat === target);
    if (!seat || target === from || !this.table.toAct.includes(target)) {
      throw new RoomError('NOT_THEIR_TURN', "It isn't that player's turn");
    }
    if (seat.isBot) throw new RoomError('NOT_THEIR_TURN', "Bots don't need nudging");
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
    this.scheduleBots();
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

  private async addBot(user: User, seat: number): Promise<void> {
    this.requireHost(user);
    this.requireBots();
    const { status } = this.table;
    if (status !== 'lobby' && status !== 'playing' && status !== 'paused') {
      throw new RoomError('WRONG_STATUS', 'This table has ended');
    }
    if (seat >= this.table.playerCount) throw new RoomError('BAD_SEAT', `There is no seat ${seat}`);
    if (this.table.seats.some((s) => s.seat === seat)) {
      throw new RoomError('SEAT_TAKEN', 'That seat is taken');
    }
    await this.seatBot(seat);
  }

  private async removeBot(user: User, seat: number): Promise<void> {
    this.requireHost(user);
    this.requireStatus('lobby', 'Bots stay in their seats once the game has started');
    if (!this.table.seats.find((s) => s.seat === seat)?.isBot) {
      throw new RoomError('BAD_SEAT', "That seat doesn't have a bot");
    }
    await this.deps.store.leaveSeat(this.table.id, seat);
    await this.reloadTable();
    this.broadcastTable();
  }

  /** A bot takes over from a player who left (isn't connected). */
  private async replaceWithBot(user: User, seat: number): Promise<void> {
    this.requireHost(user);
    this.requireBots();
    const { status } = this.table;
    if (status !== 'playing' && status !== 'paused') {
      throw new RoomError('WRONG_STATUS', 'Bots take over players only during a game');
    }
    const taken = this.table.seats.find((s) => s.seat === seat);
    if (!taken || taken.isBot) throw new RoomError('BAD_SEAT', 'There is no player in that seat');
    if (this.isConnected(taken.userId)) {
      throw new RoomError('PLAYER_CONNECTED', 'That player is still connected');
    }
    await this.deps.store.leaveSeat(this.table.id, seat);
    await this.seatBot(seat);
  }

  /** Seats this seat's bot, tells everyone and lets it play if it's its turn. */
  private async seatBot(seat: number): Promise<void> {
    // The bot in seat s is always Bot s+1, so a table never has the same bot twice.
    const bot = await this.deps.store.botUser(seat + 1);
    try {
      await this.deps.store.takeSeat(this.table.id, seat, bot.id);
    } catch (error) {
      if (error instanceof ConflictError) throw new RoomError('SEAT_TAKEN', 'That seat is taken');
      throw error;
    }
    await this.reloadTable();
    this.broadcastTable();
    this.scheduleBots();
  }

  // ---- checks ----

  private requireBots(): void {
    if (!this.bot) throw new RoomError('NO_BOTS', 'Bots only play the built-in games');
  }

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
  readingScores: number[] = [],
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
        connected: taken ? taken.isBot || isConnected(taken.userId) : false,
        bot: taken?.isBot ?? false,
      };
    }),
    botsAllowed: botFor(game) !== null,
    readingScores,
  };
}

/** The bot for a game, if bots can play it: only built-in games have bots. */
function botFor(game: GameVersion): Bot | null {
  if (!game.builtIn || !Object.hasOwn(builtInBots, game.slug)) return null;
  return builtInBots[game.slug as keyof typeof builtInBots];
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
