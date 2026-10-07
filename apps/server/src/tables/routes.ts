/**
 * Table routes. Tables are identified by their invite code everywhere a
 * client can see: having the code is what lets you see and join a table.
 *
 *   GET  /api/games                  built-in games and their options
 *   POST /api/tables                 create a table
 *   GET  /api/tables/mine            my unfinished tables
 *   GET  /api/tables/:code           a table's lobby info
 *   GET  /api/tables/:code/ws        the table's WebSocket (see protocol.ts)
 */
import { createGame, IllegalMoveError, type OptionValue, SetupError } from '@card-table/engine';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newInviteCode, newToken } from '../auth/tokens';
import type { Deps } from '../deps';
import { type GameCatalog, playerCounts } from '../games/catalog';
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

  app.post('/api/tables', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'Sign in or play as a guest first' });
    const body = createBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid table settings' });

    // Built-in games only for now; custom games (signed-in creators only) come in Phase 6.
    const game = catalog.builtIn(body.data.game);
    if (!game) return reply.code(404).send({ error: `There is no game "${body.data.game}"` });
    const counts = playerCounts(game.file);
    const playerCount = body.data.playerCount ?? counts[0] ?? 0;
    if (!counts.includes(playerCount)) {
      return reply.code(400).send({ error: `${game.name} is for ${counts.join(', ')} players` });
    }

    // Dealing a throwaway game checks the options and fills in defaults.
    let options: Record<string, OptionValue>;
    try {
      options = createGame(game.file, body.data.options ?? {}, playerCount, 'check').options;
    } catch (error) {
      if (error instanceof SetupError || error instanceof IllegalMoveError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }

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

      const allow = rateLimiter();
      const onMessage = (data: unknown) => {
        if (!allow()) {
          send(socket, {
            type: 'error',
            id: null,
            code: 'RATE_LIMITED',
            message: 'Too many messages; slow down',
          });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          parsed = undefined;
        }
        const message = clientMessageSchema.safeParse(parsed);
        if (!message.success) {
          const id = (parsed as { id?: unknown } | undefined)?.id;
          send(socket, {
            type: 'error',
            id: typeof id === 'string' || typeof id === 'number' ? id : null,
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
          seed: newToken(),
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
function rateLimiter(burst = 40, perSecond = 20): () => boolean {
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
