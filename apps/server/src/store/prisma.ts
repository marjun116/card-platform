/** The Store backed by Postgres through Prisma. */
import type { GameFile, Move, OptionValue, Scores } from '@card-table/engine';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
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

const tableInclude = {
  seats: {
    include: { user: { select: { displayName: true, isBot: true } } },
    orderBy: { seat: 'asc' },
  },
  rematch: { select: { inviteCode: true, hostId: true } },
} as const satisfies Prisma.TableInclude;

type TableRow = Prisma.TableGetPayload<{ include: typeof tableInclude }>;

function toTable(row: TableRow): Table {
  return {
    id: row.id,
    inviteCode: row.inviteCode,
    hostId: row.hostId,
    gameVersionId: row.gameVersionId,
    options: row.options as Record<string, OptionValue>,
    playerCount: row.playerCount,
    seed: row.seed,
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    toAct: row.toAct,
    turnSince: row.turnSince,
    seats: row.seats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      displayName: s.user.displayName,
      isBot: s.user.isBot,
      lastNudgeAt: s.lastNudgeAt,
    })),
    rematch: row.rematch,
  };
}

const variantInclude = {
  owner: { select: { displayName: true } },
  definition: { select: { slug: true } },
} as const satisfies Prisma.VariantInclude;

type VariantRow = Prisma.VariantGetPayload<{ include: typeof variantInclude }>;

function toVariant(row: VariantRow): Variant {
  return {
    id: row.id,
    code: row.code,
    ownerId: row.ownerId,
    ownerName: row.owner.displayName,
    definitionId: row.definitionId,
    slug: row.definition.slug,
    name: row.name,
    options: row.options as Record<string, OptionValue>,
    playerCount: row.playerCount,
    createdAt: row.createdAt,
  };
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Turns a unique-constraint failure into ConflictError. */
async function conflictOnDuplicate<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(message);
    throw error;
  }
}

export class PrismaStore implements Store {
  constructor(private readonly db: PrismaClient) {}

  createUser(data: { displayName: string; email?: string | null }): Promise<User> {
    return conflictOnDuplicate(
      this.db.user.create({ data: { displayName: data.displayName, email: data.email ?? null } }),
      'Email already in use',
    );
  }

  getUser(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  getUserByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { email } });
  }

  updateUser(id: string, patch: { displayName?: string; email?: string }): Promise<User> {
    return conflictOnDuplicate(
      this.db.user.update({ where: { id }, data: patch }),
      'Email already in use',
    );
  }

  async mergeUser(fromId: string, intoId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const intoTables = await tx.seat.findMany({
        where: { userId: intoId },
        select: { tableId: true },
      });
      await tx.seat.updateMany({
        where: { userId: fromId, tableId: { notIn: intoTables.map((s) => s.tableId) } },
        data: { userId: intoId },
      });
      await tx.table.updateMany({ where: { hostId: fromId }, data: { hostId: intoId } });
      await tx.variant.updateMany({ where: { ownerId: fromId }, data: { ownerId: intoId } });
      await tx.session.deleteMany({ where: { userId: fromId } });
    });
  }

  botUser(n: number): Promise<User> {
    const id = `bot-${n}`;
    return this.db.user.upsert({
      where: { id },
      create: { id, displayName: `Bot ${n}`, isBot: true },
      update: {},
    });
  }

  async createSession(session: Session): Promise<void> {
    await this.db.session.create({ data: session });
  }

  getSession(id: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { id } });
  }

  async touchSession(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.db.session.updateMany({ where: { id }, data: { lastSeenAt, expiresAt } });
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id } });
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { userId } });
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.session.deleteMany({ where: { expiresAt: { lte: now } } });
    await this.db.loginToken.deleteMany({
      where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lte: now } }] },
    });
  }

  async createLoginToken(token: LoginToken): Promise<void> {
    await this.db.loginToken.create({ data: token });
  }

  async consumeLoginToken(tokenHash: string, now: Date): Promise<LoginToken | null> {
    // One conditional update, so two clicks on the same link can't both succeed.
    const { count } = await this.db.loginToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1 ? this.db.loginToken.findUnique({ where: { tokenHash } }) : null;
  }

  async saveBuiltInGame(data: {
    slug: string;
    name: string;
    file: GameFile;
    fileHash: string;
  }): Promise<GameVersion> {
    return this.db.$transaction(async (tx) => {
      const definition = await tx.gameDefinition.upsert({
        where: { slug: data.slug },
        create: { slug: data.slug, name: data.name, builtIn: true },
        update: { name: data.name },
      });
      const latest = await tx.gameVersion.findFirst({
        where: { definitionId: definition.id },
        orderBy: { version: 'desc' },
      });
      const row =
        latest?.fileHash === data.fileHash
          ? latest
          : await tx.gameVersion.create({
              data: {
                definitionId: definition.id,
                version: (latest?.version ?? 0) + 1,
                file: json(data.file),
                fileHash: data.fileHash,
              },
            });
      return {
        id: row.id,
        definitionId: definition.id,
        slug: definition.slug,
        name: definition.name,
        builtIn: definition.builtIn,
        version: row.version,
        file: row.file as unknown as GameFile,
        fileHash: row.fileHash,
      };
    });
  }

  async getGameVersion(id: string): Promise<GameVersion | null> {
    const row = await this.db.gameVersion.findUnique({
      where: { id },
      include: { definition: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      definitionId: row.definitionId,
      slug: row.definition.slug,
      name: row.definition.name,
      builtIn: row.definition.builtIn,
      version: row.version,
      file: row.file as unknown as GameFile,
      fileHash: row.fileHash,
    };
  }

  async createTable(data: NewTable): Promise<Table> {
    const row = await conflictOnDuplicate(
      this.db.table.create({
        data: { ...data, options: json(data.options) },
        include: tableInclude,
      }),
      'Invite code already in use',
    );
    return toTable(row);
  }

  async createRematch(
    fromId: string,
    data: NewTable,
    seats: { seat: number; userId: string }[],
  ): Promise<Table> {
    const row = await conflictOnDuplicate(
      this.db.$transaction(async (tx) => {
        const table = await tx.table.create({
          data: { ...data, options: json(data.options), seats: { create: seats } },
        });
        // Only if it has no rematch yet; otherwise the new table goes too.
        const linked = await tx.table.updateMany({
          where: { id: fromId, rematchId: null },
          data: { rematchId: table.id },
        });
        if (linked.count === 0) throw new ConflictError('The table already has a rematch');
        return tx.table.findUniqueOrThrow({ where: { id: table.id }, include: tableInclude });
      }),
      'Invite code already in use',
    );
    return toTable(row);
  }

  async getTable(id: string): Promise<Table | null> {
    const row = await this.db.table.findUnique({ where: { id }, include: tableInclude });
    return row && toTable(row);
  }

  async getTableByInviteCode(code: string): Promise<Table | null> {
    const row = await this.db.table.findUnique({
      where: { inviteCode: code },
      include: tableInclude,
    });
    return row && toTable(row);
  }

  async listOpenTables(userId: string): Promise<Table[]> {
    const rows = await this.db.table.findMany({
      where: {
        status: { in: ['lobby', 'playing', 'paused'] },
        OR: [{ hostId: userId }, { seats: { some: { userId } } }],
      },
      include: tableInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toTable);
  }

  async updateTable(id: string, patch: TablePatch): Promise<Table> {
    return toTable(
      await this.db.table.update({ where: { id }, data: patch, include: tableInclude }),
    );
  }

  async listPastTables(
    userId: string,
    page: { offset: number; limit: number },
  ): Promise<PastTable[]> {
    const rows = await this.db.table.findMany({
      where: {
        OR: [{ status: 'finished' }, { status: 'abandoned', startedAt: { not: null } }],
        seats: { some: { userId } },
      },
      include: { ...tableInclude, result: true },
      orderBy: [{ endedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit,
    });
    return rows.map((row) => ({
      ...toTable(row),
      result: row.result && {
        winners: row.result.winners,
        scores: row.result.scores as unknown as Scores,
      },
    }));
  }

  async listPlayedResults(userId: string): Promise<PlayedResult[]> {
    const seats = await this.db.seat.findMany({
      where: { userId, table: { status: 'finished', result: { isNot: null } } },
      select: {
        seat: true,
        table: { select: { gameVersionId: true, result: { select: { winners: true } } } },
      },
    });
    return seats.map((s) => ({
      gameVersionId: s.table.gameVersionId,
      seat: s.seat,
      winners: s.table.result?.winners ?? [],
    }));
  }

  async takeSeat(tableId: string, seat: number, userId: string): Promise<void> {
    await conflictOnDuplicate(
      this.db.seat.create({ data: { tableId, seat, userId } }),
      'Seat taken, or already seated',
    );
  }

  async leaveSeat(tableId: string, seat: number): Promise<void> {
    await this.db.seat.deleteMany({ where: { tableId, seat } });
  }

  async setNudged(tableId: string, seat: number, at: Date): Promise<void> {
    await this.db.seat.updateMany({ where: { tableId, seat }, data: { lastNudgeAt: at } });
  }

  async createVariant(data: NewVariant): Promise<Variant> {
    const row = await conflictOnDuplicate(
      this.db.variant.create({
        data: { ...data, options: json(data.options) },
        include: variantInclude,
      }),
      'Variant code already in use',
    );
    return toVariant(row);
  }

  async getVariantByCode(code: string): Promise<Variant | null> {
    const row = await this.db.variant.findUnique({ where: { code }, include: variantInclude });
    return row && toVariant(row);
  }

  async listVariants(ownerId: string): Promise<Variant[]> {
    const rows = await this.db.variant.findMany({
      where: { ownerId },
      include: variantInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toVariant);
  }

  async deleteTable(id: string): Promise<void> {
    // Seats, moves and the result go with it (onDelete: Cascade).
    await this.db.table.deleteMany({ where: { id } });
  }

  async deleteVariant(id: string): Promise<void> {
    await this.db.variant.deleteMany({ where: { id } });
  }

  async recordMove(tableId: string, seq: number, move: Move, after: AfterMove): Promise<void> {
    const { finished } = after;
    await conflictOnDuplicate(
      this.db.$transaction([
        this.db.moveLog.create({ data: { tableId, seq, move: json(move) } }),
        this.db.table.update({
          where: { id: tableId },
          data: {
            toAct: after.toAct,
            turnSince: after.turnSince,
            ...(finished && { status: 'finished', endedAt: finished.endedAt }),
          },
        }),
        ...(finished
          ? [
              this.db.result.create({
                data: {
                  tableId,
                  winners: finished.result.winners,
                  scores: json(finished.result.scores),
                },
              }),
            ]
          : []),
      ]),
      `Move ${seq} already saved`,
    );
  }

  async listMoves(tableId: string): Promise<Move[]> {
    const rows = await this.db.moveLog.findMany({ where: { tableId }, orderBy: { seq: 'asc' } });
    return rows.map((r) => r.move as unknown as Move);
  }

  async getResult(tableId: string): Promise<Result | null> {
    const row = await this.db.result.findUnique({ where: { tableId } });
    return row && { winners: row.winners, scores: row.scores as unknown as Scores };
  }

  async findIdleTurns(before: Date): Promise<IdleTurn[]> {
    const rows = await this.db.table.findMany({
      where: { status: 'playing', turnSince: { lt: before } },
      include: { seats: { include: { user: { select: { isBot: true } } } } },
    });
    return rows.flatMap((table) =>
      table.seats
        .filter((s) => table.toAct.includes(s.seat) && !s.user.isBot)
        .filter((s) => !s.lastNudgeAt || (table.turnSince && s.lastNudgeAt < table.turnSince))
        .map((s) => ({ tableId: table.id, seat: s.seat, userId: s.userId })),
    );
  }
}
