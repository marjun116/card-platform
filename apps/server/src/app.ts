import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { consoleMailer } from './auth/mailer';
import { authRoutes } from './auth/routes';
import { registerSessions } from './auth/session';
import { defaultConfig } from './config';
import type { Deps } from './deps';
import { GameCatalog } from './games/catalog';
import { MemoryStore } from './store/memory';
import { loggingNotifier } from './tables/notifier';
import { Rooms } from './tables/rooms';
import { tableRoutes } from './tables/routes';

declare module 'fastify' {
  interface FastifyInstance {
    /** Open tables. Tests use it to run the idle-turn check on demand. */
    rooms: Rooms;
  }
}

/** Largest WebSocket message accepted from a client. */
const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * Builds the app without starting it, so tests can call routes in memory.
 * Anything not passed in gets a test-friendly default (an in-memory store,
 * links printed to the console); src/index.ts passes the real ones.
 */
export async function buildApp(overrides: Partial<Deps> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const deps: Deps = {
    store: new MemoryStore(),
    mailer: consoleMailer,
    notifier: loggingNotifier((message) => app.log.info(message)),
    config: defaultConfig,
    now: () => new Date(),
    ...overrides,
  };

  const catalog = new GameCatalog(deps.store);
  await catalog.syncBuiltIns();
  const rooms = new Rooms(deps, catalog);
  app.decorate('rooms', rooms);

  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
  await registerSessions(app, deps);

  app.get('/api/health', () => ({ status: 'ok' }));
  authRoutes(app, deps);
  tableRoutes(app, deps, catalog, rooms);

  // Look for idle turns now and then, once the server is listening.
  let sweep: NodeJS.Timeout | undefined;
  app.addHook('onListen', () => {
    sweep = setInterval(() => {
      rooms.sweepIdleTurns().catch((error: unknown) => app.log.error(error));
    }, deps.config.idleCheckEveryMs);
    sweep.unref();
  });
  app.addHook('onClose', () => clearInterval(sweep));

  return app;
}
