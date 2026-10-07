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
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test' && {
      serializers: {
        // Log requests without secrets: sign-in links carry their token in the URL.
        req: (req: { method: string; url: string; ip?: string }) => ({
          method: req.method,
          url: redactSecrets(req.url),
          remoteAddress: req.ip,
        }),
      },
    },
  });
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

  // Unexpected errors are logged in full but reported to the client without
  // details, which could reveal database or code internals.
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Something went wrong on the server' });
    }
    return reply.code(status).send({ error: error.message });
  });

  app.get('/api/health', () => ({ status: 'ok' }));
  authRoutes(app, deps);
  tableRoutes(app, deps, catalog, rooms);

  // Now and then, once the server is listening: nudge idle turns and delete
  // expired sessions and sign-in links.
  let sweep: NodeJS.Timeout | undefined;
  app.addHook('onListen', () => {
    sweep = setInterval(() => {
      rooms.sweepIdleTurns().catch((error: unknown) => app.log.error(error));
      deps.store.deleteExpired(deps.now()).catch((error: unknown) => app.log.error(error));
    }, deps.config.idleCheckEveryMs);
    sweep.unref();
  });
  app.addHook('onClose', () => clearInterval(sweep));

  return app;
}

/** Hides secret query values (sign-in tokens) in a URL before it's logged. */
export function redactSecrets(url: string): string {
  return url.replace(/([?&]token=)[^&]*/g, '$1[redacted]');
}
