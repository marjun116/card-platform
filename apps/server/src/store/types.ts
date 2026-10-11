/**
 * Everything the server keeps in the database goes through this interface.
 * PrismaStore is the real one; MemoryStore keeps it all in memory for tests.
 * Records are plain objects: changing one never changes what's stored.
 */
import type { GameFile, Move, OptionValue, Scores } from '@card-table/engine';

export interface User {
  id: string;
  displayName: string;
  /** null for guests. */
  email: string | null;
  /** A computer player; see Store.botUser. */
  isBot: boolean;
  createdAt: Date;
}

export interface Session {
  /** SHA-256 of the cookie token. */
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
}

export interface LoginToken {
  tokenHash: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface GameVersion {
  id: string;
  definitionId: string;
  slug: string;
  name: string;
  builtIn: boolean;
  version: number;
  file: GameFile;
  fileHash: string;
}

export type TableStatus = 'lobby' | 'playing' | 'paused' | 'finished' | 'abandoned';

export interface Seat {
  seat: number;
  userId: string;
  displayName: string;
  isBot: boolean;
  lastNudgeAt: Date | null;
}

export interface Table {
  id: string;
  inviteCode: string;
  hostId: string;
  gameVersionId: string;
  options: Record<string, OptionValue>;
  playerCount: number;
  seed: string;
  status: TableStatus;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  /** Seats with a move to make. */
  toAct: number[];
  /** When the current turn began. */
  turnSince: Date | null;
  /** Filled seats, sorted by seat number. */
  seats: Seat[];
}

export interface Result {
  winners: number[];
  scores: Scores;
}

/** A table that's over, for game history. */
export interface PastTable extends Table {
  /** null when the host ended the game early. */
  result: Result | null;
}

/** One finished game a user sat at, for their stats. */
export interface PlayedResult {
  gameVersionId: string;
  seat: number;
  winners: number[];
}

export type TablePatch = Partial<
  Pick<Table, 'status' | 'startedAt' | 'endedAt' | 'toAct' | 'turnSince'>
>;

export interface NewTable {
  inviteCode: string;
  hostId: string;
  gameVersionId: string;
  options: Record<string, OptionValue>;
  playerCount: number;
  seed: string;
}

/** A saved set of house rules for a game; see the Variant model in schema.prisma. */
export interface Variant {
  id: string;
  code: string;
  ownerId: string;
  ownerName: string;
  definitionId: string;
  /** The game's slug. */
  slug: string;
  name: string;
  options: Record<string, OptionValue>;
  playerCount: number;
  createdAt: Date;
}

export interface NewVariant {
  code: string;
  ownerId: string;
  definitionId: string;
  name: string;
  options: Record<string, OptionValue>;
  playerCount: number;
}

/** What changes along with a saved move. */
export interface AfterMove {
  toAct: number[];
  turnSince: Date | null;
  /** Set when the move ended the game. */
  finished?: { endedAt: Date; result: Result };
}

export interface IdleTurn {
  tableId: string;
  seat: number;
  userId: string;
}

/** A write that clashes with existing data: a taken seat, or a move number already used. */
export class ConflictError extends Error {
  override name = 'ConflictError';
}

export interface Store {
  // Users and sessions
  createUser(data: { displayName: string; email?: string | null }): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  updateUser(id: string, patch: { displayName?: string; email?: string }): Promise<User>;
  /**
   * Moves `fromId`'s seats, hosted tables and variants to `intoId` and signs `fromId` out
   * everywhere. Seats at tables where `intoId` already sits stay with `fromId`.
   */
  mergeUser(fromId: string, intoId: string): Promise<void>;
  /**
   * The bot account "Bot n", created the first time it's needed. A table's
   * bot in seat s is Bot s+1, so no two bots share a table.
   */
  botUser(n: number): Promise<User>;

  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  touchSession(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;

  /** Deletes sessions and sign-in links that have expired, and links already used. */
  deleteExpired(now: Date): Promise<void>;

  createLoginToken(token: LoginToken): Promise<void>;
  /** Marks the token used and returns it, or null if it's unknown, used or expired. */
  consumeLoginToken(tokenHash: string, now: Date): Promise<LoginToken | null>;

  // Games
  /** Saves a built-in game file, adding a new version only if the file changed. */
  saveBuiltInGame(data: {
    slug: string;
    name: string;
    file: GameFile;
    fileHash: string;
  }): Promise<GameVersion>;
  getGameVersion(id: string): Promise<GameVersion | null>;

  // Tables
  createTable(data: NewTable): Promise<Table>;
  getTable(id: string): Promise<Table | null>;
  getTableByInviteCode(code: string): Promise<Table | null>;
  /** Unfinished tables the user hosts or sits at, newest first. */
  listOpenTables(userId: string): Promise<Table[]>;
  updateTable(id: string, patch: TablePatch): Promise<Table>;
  /**
   * Tables the user sat at that are over: finished, or ended early after they
   * started. Most recently ended first.
   */
  listPastTables(userId: string, page: { offset: number; limit: number }): Promise<PastTable[]>;
  /** Every finished game the user sat at (not ones ended early). */
  listPlayedResults(userId: string): Promise<PlayedResult[]>;
  /** Throws ConflictError if the seat is taken or the user already sits at this table. */
  takeSeat(tableId: string, seat: number, userId: string): Promise<void>;
  leaveSeat(tableId: string, seat: number): Promise<void>;
  setNudged(tableId: string, seat: number, at: Date): Promise<void>;

  // Variants
  /** Throws ConflictError if the code is taken. */
  createVariant(data: NewVariant): Promise<Variant>;
  getVariantByCode(code: string): Promise<Variant | null>;
  /** The user's variants, newest first. */
  listVariants(ownerId: string): Promise<Variant[]>;
  deleteVariant(id: string): Promise<void>;

  // Moves and results
  /** Saves move number `seq` and the table changes it causes, all or nothing. */
  recordMove(tableId: string, seq: number, move: Move, after: AfterMove): Promise<void>;
  listMoves(tableId: string): Promise<Move[]>;
  getResult(tableId: string): Promise<Result | null>;
  /**
   * Seats whose turn began before `before`, at playing tables, that haven't
   * been nudged since their turn began. Bots are never idle.
   */
  findIdleTurns(before: Date): Promise<IdleTurn[]>;
}
