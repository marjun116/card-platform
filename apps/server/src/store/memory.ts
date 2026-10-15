/** A Store that keeps everything in memory. Used by tests; behaves like PrismaStore. */
import { randomUUID } from 'node:crypto';
import type { Move } from '@card-table/engine';
import {
  type AfterMove,
  ConflictError,
  type GameVersion,
  type IdleTurn,
  type LoginToken,
  type NewTable,
  type NewVariant,
  type PastTable,
  type PlayedResult,
  type Result,
  type Session,
  type Store,
  type Table,
  type TablePatch,
  type User,
  type Variant,
} from './types';

type StoredTable = Omit<Table, 'seats'>;
type StoredVariant = Omit<Variant, 'ownerName' | 'slug'>;
interface StoredSeat {
  tableId: string;
  seat: number;
  userId: string;
  lastNudgeAt: Date | null;
}

const copy = <T>(value: T): T => structuredClone(value);

/** Over: finished, or ended early after it started. */
const isPast = (t: StoredTable) =>
  t.status === 'finished' || (t.status === 'abandoned' && t.startedAt !== null);

export class MemoryStore implements Store {
  private users = new Map<string, User>();
  private sessions = new Map<string, Session>();
  private loginTokens = new Map<string, LoginToken>();
  private versions = new Map<string, GameVersion>();
  private tables = new Map<string, StoredTable>();
  private seats: StoredSeat[] = [];
  private moves = new Map<string, Move[]>();
  private results = new Map<string, Result>();
  private variants = new Map<string, StoredVariant>();

  createUser(data: { displayName: string; email?: string | null }): Promise<User> {
    if (data.email && this.findByEmail(data.email)) {
      return Promise.reject(new ConflictError('Email already in use'));
    }
    const user: User = {
      id: randomUUID(),
      displayName: data.displayName,
      email: data.email ?? null,
      isBot: false,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return Promise.resolve(copy(user));
  }

  getUser(id: string): Promise<User | null> {
    return Promise.resolve(copy(this.users.get(id) ?? null));
  }

  getUserByEmail(email: string): Promise<User | null> {
    return Promise.resolve(copy(this.findByEmail(email) ?? null));
  }

  updateUser(id: string, patch: { displayName?: string; email?: string }): Promise<User> {
    const user = this.users.get(id);
    if (!user) return Promise.reject(new Error(`No user ${id}`));
    if (patch.email && this.findByEmail(patch.email)) {
      return Promise.reject(new ConflictError('Email already in use'));
    }
    Object.assign(user, patch);
    return Promise.resolve(copy(user));
  }

  botUser(n: number): Promise<User> {
    const id = `bot-${n}`;
    let user = this.users.get(id);
    if (!user) {
      user = { id, displayName: `Bot ${n}`, email: null, isBot: true, createdAt: new Date() };
      this.users.set(id, user);
    }
    return Promise.resolve(copy(user));
  }

  mergeUser(fromId: string, intoId: string): Promise<void> {
    for (const seat of this.seats) {
      if (seat.userId !== fromId) continue;
      const clash = this.seats.some((s) => s.tableId === seat.tableId && s.userId === intoId);
      if (!clash) seat.userId = intoId;
    }
    for (const table of this.tables.values()) {
      if (table.hostId === fromId) table.hostId = intoId;
    }
    for (const variant of this.variants.values()) {
      if (variant.ownerId === fromId) variant.ownerId = intoId;
    }
    return this.deleteUserSessions(fromId);
  }

  createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, copy(session));
    return Promise.resolve();
  }

  getSession(id: string): Promise<Session | null> {
    return Promise.resolve(copy(this.sessions.get(id) ?? null));
  }

  touchSession(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) Object.assign(session, { lastSeenAt, expiresAt });
    return Promise.resolve();
  }

  deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }

  deleteUserSessions(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(id);
    }
    return Promise.resolve();
  }

  deleteExpired(now: Date): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
    for (const [hash, token] of this.loginTokens) {
      if (token.usedAt || token.expiresAt <= now) this.loginTokens.delete(hash);
    }
    return Promise.resolve();
  }

  createLoginToken(token: LoginToken): Promise<void> {
    this.loginTokens.set(token.tokenHash, copy(token));
    return Promise.resolve();
  }

  consumeLoginToken(tokenHash: string, now: Date): Promise<LoginToken | null> {
    const token = this.loginTokens.get(tokenHash);
    if (!token || token.usedAt || token.expiresAt <= now) return Promise.resolve(null);
    token.usedAt = now;
    return Promise.resolve(copy(token));
  }

  saveBuiltInGame(data: {
    slug: string;
    name: string;
    file: GameVersion['file'];
    fileHash: string;
  }): Promise<GameVersion> {
    const existing = [...this.versions.values()].filter((v) => v.slug === data.slug);
    const latest = existing.sort((a, b) => b.version - a.version)[0];
    if (latest?.fileHash === data.fileHash) return Promise.resolve(copy(latest));
    const version: GameVersion = {
      id: randomUUID(),
      definitionId: latest?.definitionId ?? randomUUID(),
      slug: data.slug,
      name: data.name,
      builtIn: true,
      version: (latest?.version ?? 0) + 1,
      file: copy(data.file),
      fileHash: data.fileHash,
    };
    this.versions.set(version.id, version);
    return Promise.resolve(copy(version));
  }

  getGameVersion(id: string): Promise<GameVersion | null> {
    return Promise.resolve(copy(this.versions.get(id) ?? null));
  }

  createTable(data: NewTable): Promise<Table> {
    if ([...this.tables.values()].some((t) => t.inviteCode === data.inviteCode)) {
      return Promise.reject(new ConflictError('Invite code already in use'));
    }
    const table: StoredTable = {
      ...copy(data),
      id: randomUUID(),
      status: 'lobby',
      createdAt: new Date(),
      startedAt: null,
      endedAt: null,
      toAct: [],
      turnSince: null,
    };
    this.tables.set(table.id, table);
    return Promise.resolve(this.withSeats(table));
  }

  getTable(id: string): Promise<Table | null> {
    const table = this.tables.get(id);
    return Promise.resolve(table ? this.withSeats(table) : null);
  }

  getTableByInviteCode(code: string): Promise<Table | null> {
    const table = [...this.tables.values()].find((t) => t.inviteCode === code);
    return Promise.resolve(table ? this.withSeats(table) : null);
  }

  listOpenTables(userId: string): Promise<Table[]> {
    const open = [...this.tables.values()]
      .filter((t) => t.status === 'lobby' || t.status === 'playing' || t.status === 'paused')
      .filter(
        (t) =>
          t.hostId === userId || this.seats.some((s) => s.tableId === t.id && s.userId === userId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(open.map((t) => this.withSeats(t)));
  }

  updateTable(id: string, patch: TablePatch): Promise<Table> {
    const table = this.tables.get(id);
    if (!table) return Promise.reject(new Error(`No table ${id}`));
    Object.assign(table, copy(patch));
    return Promise.resolve(this.withSeats(table));
  }

  listPastTables(userId: string, page: { offset: number; limit: number }): Promise<PastTable[]> {
    const past = [...this.tables.values()]
      .filter((t) => isPast(t) && this.seatOf(t.id, userId) !== undefined)
      .sort(
        (a, b) =>
          (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0) || b.id.localeCompare(a.id),
      )
      .slice(page.offset, page.offset + page.limit);
    return Promise.resolve(
      past.map((t) => ({ ...this.withSeats(t), result: copy(this.results.get(t.id) ?? null) })),
    );
  }

  listPlayedResults(userId: string): Promise<PlayedResult[]> {
    const played: PlayedResult[] = [];
    for (const table of this.tables.values()) {
      const seat = this.seatOf(table.id, userId);
      const result = this.results.get(table.id);
      if (table.status !== 'finished' || seat === undefined || !result) continue;
      played.push({ gameVersionId: table.gameVersionId, seat, winners: [...result.winners] });
    }
    return Promise.resolve(played);
  }

  takeSeat(tableId: string, seat: number, userId: string): Promise<void> {
    if (this.seats.some((s) => s.tableId === tableId && (s.seat === seat || s.userId === userId))) {
      return Promise.reject(new ConflictError('Seat taken, or already seated'));
    }
    this.seats.push({ tableId, seat, userId, lastNudgeAt: null });
    return Promise.resolve();
  }

  leaveSeat(tableId: string, seat: number): Promise<void> {
    this.seats = this.seats.filter((s) => !(s.tableId === tableId && s.seat === seat));
    return Promise.resolve();
  }

  setNudged(tableId: string, seat: number, at: Date): Promise<void> {
    const found = this.seats.find((s) => s.tableId === tableId && s.seat === seat);
    if (found) found.lastNudgeAt = at;
    return Promise.resolve();
  }

  createVariant(data: NewVariant): Promise<Variant> {
    if ([...this.variants.values()].some((v) => v.code === data.code)) {
      return Promise.reject(new ConflictError('Variant code already in use'));
    }
    const variant: StoredVariant = { ...copy(data), id: randomUUID(), createdAt: new Date() };
    this.variants.set(variant.id, variant);
    return Promise.resolve(this.fullVariant(variant));
  }

  getVariantByCode(code: string): Promise<Variant | null> {
    const variant = [...this.variants.values()].find((v) => v.code === code);
    return Promise.resolve(variant ? this.fullVariant(variant) : null);
  }

  listVariants(ownerId: string): Promise<Variant[]> {
    const mine = [...this.variants.values()]
      .filter((v) => v.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(mine.map((v) => this.fullVariant(v)));
  }

  deleteTable(id: string): Promise<void> {
    this.tables.delete(id);
    this.seats = this.seats.filter((s) => s.tableId !== id);
    this.moves.delete(id);
    this.results.delete(id);
    return Promise.resolve();
  }

  deleteVariant(id: string): Promise<void> {
    this.variants.delete(id);
    return Promise.resolve();
  }

  recordMove(tableId: string, seq: number, move: Move, after: AfterMove): Promise<void> {
    const table = this.tables.get(tableId);
    if (!table) return Promise.reject(new Error(`No table ${tableId}`));
    const log = this.moves.get(tableId) ?? [];
    if (seq !== log.length) return Promise.reject(new ConflictError(`Move ${seq} already saved`));
    log.push(copy(move));
    this.moves.set(tableId, log);
    table.toAct = [...after.toAct];
    table.turnSince = after.turnSince;
    if (after.finished) {
      table.status = 'finished';
      table.endedAt = after.finished.endedAt;
      this.results.set(tableId, copy(after.finished.result));
    }
    return Promise.resolve();
  }

  listMoves(tableId: string): Promise<Move[]> {
    return Promise.resolve(copy(this.moves.get(tableId) ?? []));
  }

  getResult(tableId: string): Promise<Result | null> {
    return Promise.resolve(copy(this.results.get(tableId) ?? null));
  }

  findIdleTurns(before: Date): Promise<IdleTurn[]> {
    const idle: IdleTurn[] = [];
    for (const table of this.tables.values()) {
      const since = table.turnSince;
      if (table.status !== 'playing' || !since || since >= before) continue;
      for (const seat of this.seats) {
        if (seat.tableId !== table.id || !table.toAct.includes(seat.seat)) continue;
        if (seat.lastNudgeAt && seat.lastNudgeAt >= since) continue;
        if (this.users.get(seat.userId)?.isBot) continue;
        idle.push({ tableId: table.id, seat: seat.seat, userId: seat.userId });
      }
    }
    return Promise.resolve(idle);
  }

  private seatOf(tableId: string, userId: string): number | undefined {
    return this.seats.find((s) => s.tableId === tableId && s.userId === userId)?.seat;
  }

  private findByEmail(email: string): User | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }

  private fullVariant(variant: StoredVariant): Variant {
    const slug = [...this.versions.values()].find(
      (v) => v.definitionId === variant.definitionId,
    )?.slug;
    return copy({
      ...variant,
      ownerName: this.users.get(variant.ownerId)?.displayName ?? '?',
      slug: slug ?? '?',
    });
  }

  private withSeats(table: StoredTable): Table {
    const seats = this.seats
      .filter((s) => s.tableId === table.id)
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        seat: s.seat,
        userId: s.userId,
        displayName: this.users.get(s.userId)?.displayName ?? '?',
        isBot: this.users.get(s.userId)?.isBot ?? false,
        lastNudgeAt: s.lastNudgeAt,
      }));
    return copy({ ...table, seats });
  }
}
