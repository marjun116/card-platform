/**
 * Table routes. Tables are identified by their invite code everywhere a
 * client can see: having the code is what lets you see and join a table.
 *
 *   GET  /api/games                  built-in games and their options
 *   GET  /api/games/:slug/rules      a game's rulebook
 *   POST /api/tables                 create a table
 *   GET  /api/tables/mine            my unfinished tables
 *   GET  /api/tables/:code           a table's lobby info
 *   DELETE /api/tables/:code         the host deletes a table (and its game) for everyone
 *   GET  /api/tables/:code/rounds/:n a finished round with every hand face up (seated players)
 *   GET  /api/tables/:code/ws        the table's WebSocket (see protocol.ts)
 */
import { type OptionValue, replayRound } from '@card-table/engine';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newInviteCode } from '../auth/tokens';
import type { Deps } from '../deps';
import type { GameCatalog } from '../games/catalog';
import { checkSettings } from '../games/settings';
import { ConflictError, type Table, type User } from '../store/types';
import { clientMessageSchema, type TableInfo } from './protocol';
import { send, sendError, tableInfo, type TableRoom } from './room';
import type { Rooms } from './rooms';

const createBody = z.strictObject({
  game: z.string().min(1).max(64),
  options: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
  playerCount: z.number().int().min(1).max(10).optional(),
});
const codeParams = z.object({ code: z.string().min(1).max(32) });
const roundParams = codeParams.extend({ round: z.coerce.number().int().min(1).max(10_000) });
const slugParams = z.object({ slug: z.string().min(1).max(64) });

const PING_EVERY_MS = 30_000;
/** Messages held while a connection is being set up; more than this closes it. */
const MAX_EARLY_MESSAGES = 50;

export function tableRoutes(
  app: FastifyInstance,
  deps: Deps,
  catalog: GameCatalog,
  rooms: Rooms,
): void {
  const { store, config } = deps;

  app.get('/api/games', () => ({ games: catalog.list() }));

  app.get('/api/games/:slug/rules', (request, reply) => {
    const params = slugParams.safeParse(request.params);
    const rules = params.success ? catalog.rules(params.data.slug) : undefined;
    if (rules === undefined) return reply.code(404).send({ error: 'No rules for that game' });
    return { rules };
  });

  app.post('/api/tables', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'Sign in or play as a guest first' });
    const body = createBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid table settings' });

    const settings = checkSettings(
      catalog,
      body.data.game,
      body.data.options,
      body.data.playerCount,
    );
    if ('error' in settings) return reply.code(settings.status).send({ error: settings.error });
    const { game, options, playerCount } = settings;

    const table = await createWithFreshCode(user, game.id, options, playerCount);
    return reply.code(201).send({ table: await infoFor(table) });
  });

  app.get('/api/tables/mine', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    const tables = await store.listOpenTables(request.user.id);
    return { tables: await Promise.all(tables.map(infoFor)) };
  });

  app.get('/api/tables/:code', async (request, reply) => {
    const table = await tableFromParams(request);
    if (!table) return reply.code(404).send({ error: 'No table with that code' });
    return { table: await infoFor(table) };
  });

  // A round's hands become public once the round is over, and only to the table's players:
  // the engine plays back nothing of a round still being played.
  app.get('/api/tables/:code/rounds/:round', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    const params = roundParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid round' });
    const table = await store.getTableByInviteCode(params.data.code.toUpperCase());
    if (!table) return reply.code(404).send({ error: 'No table with that code' });
    const userId = request.user.id;
    if (!table.seats.some((seat) => seat.userId === userId)) {
      return reply.code(403).send({ error: "Only the table's players can see its hands" });
    }
    const game = await catalog.version(table.gameVersionId);
    const moves = table.startedAt ? await store.listMoves(table.id) : [];
    const replay = table.startedAt
      ? replayRound(
          game.file,
          table.options,
          table.playerCount,
          table.seed,
          moves,
          params.data.round,
        )
      : null;
    if (!replay) return reply.code(404).send({ error: "That round isn't over" });
    return { replay };
  });

  app.delete('/api/tables/:code', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    const table = await tableFromParams(request);
    if (!table) return reply.code(404).send({ error: 'No table with that code' });
    if (table.hostId !== request.user.id) {
      return reply.code(403).send({ error: 'Only the host can delete a table' });
    }
    await rooms.delete(table);
    return { ok: true };
  });

  app.get(
    '/api/tables/:code/ws',
    {
      websocket: true,
      // Checked before the connection is upgraded, so failures are plain HTTP errors.
      preValidation: async (request, reply) => {
        if (!originAllowed(request)) return reply.code(403).send({ error: 'Origin not allowed' });
        if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
        if (!(await tableFromParams(request))) {
          return reply.code(404).send({ error: 'No table with that code' });
        }
      },
    },
    async (socket, request) => {
      // Listen before the first `await`: the socket is already open, so messages
      // or a close that arrive with no listener would be lost. Messages are held
      // until the room is ready, so none are dropped or handled out of order.
      const early: unknown[] = [];
      let closed = false;
      socket.on('message', (data) => {
        if (early.length < MAX_EARLY_MESSAGES) early.push(data);
        else socket.close(1008, 'Too many messages');
      });
      socket.on('close', () => (closed = true));

      const user = request.user as User;
      let room: TableRoom;
      try {
        const table = await tableFromParams(request);
        if (!table) throw new Error('Table disappeared while connecting');
        room = await rooms.join(table, socket, user);
      } catch (error) {
        sendError(socket, null, error);
        socket.close(1011);
        return;
      }
      socket.removeAllListeners('message');
      socket.removeAllListeners('close');
      // Closed while we were setting up: undo the join, or the room would keep it forever.
      if (closed) {
        await rooms.leave(room, socket);
        return;
      }
      socket.on('close', () => {
        void rooms.leave(room, socket);
      });

      const allow = rateLimiter(config.messageBurst, config.messagesPerSecond);
      const onMessage = (data: unknown) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          parsed = undefined;
        }
        // Every error echoes the message's id when it has one, so the client can match it up.
        const rawId = (parsed as { id?: unknown } | undefined)?.id;
        const id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
        if (!allow()) {
          send(socket, {
            type: 'error',
            id,
            code: 'RATE_LIMITED',
            message: 'Too many messages; slow down',
          });
          return;
        }
        const message = clientMessageSchema.safeParse(parsed);
        if (!message.success) {
          send(socket, {
            type: 'error',
            id,
            code: 'BAD_MESSAGE',
            message: "The server didn't understand that message",
          });
          return;
        }
        void room.handle(socket, user, message.data);
      };
      socket.on('message', onMessage);
      for (const data of early) onMessage(data);

      keepAlive(socket);
    },
  );

  async function createWithFreshCode(
    user: User,
    gameVersionId: string,
    options: Record<string, OptionValue>,
    playerCount: number,
  ): Promise<Table> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await store.createTable({
          inviteCode: newInviteCode(),
          hostId: user.id,
          gameVersionId,
          options,
          playerCount,
          seed: deps.newSeed(),
        });
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= 4) throw error;
      }
    }
  }

  async function tableFromParams(request: FastifyRequest): Promise<Table | null> {
    const params = codeParams.safeParse(request.params);
    return params.success ? store.getTableByInviteCode(params.data.code.toUpperCase()) : null;
  }

  /** Lobby info, including who has the table open right now. */
  async function infoFor(table: Table): Promise<TableInfo> {
    const game = await catalog.version(table.gameVersionId);
    return tableInfo(table, game, (userId) => rooms.isConnected(table.id, userId));
  }

  /** Browsers always send Origin on WebSocket requests; refuse ones from other sites. */
  function originAllowed(request: FastifyRequest): boolean {
    const origin = request.headers.origin;
    return origin === undefined || origin === new URL(config.publicUrl).origin;
  }
}

/**
 * Allows a burst of messages, refilled steadily: far more than any real
 * player needs, but a flood can't pile up work in the table's queue.
 */
function rateLimiter(burst: number, perSecond: number): () => boolean {
  let tokens = burst;
  let last = performance.now();
  return () => {
    const now = performance.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/** Pings every 30 seconds and drops connections that stop answering, so presence stays accurate. */
function keepAlive(socket: WebSocket): void {
  let alive = true;
  socket.on('pong', () => (alive = true));
  const timer = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, PING_EVERY_MS);
  timer.unref();
  socket.on('close', () => clearInterval(timer));
}
