import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { consoleMailer } from './auth/mailer';
import { authRoutes } from './auth/routes';
import { registerSessions } from './auth/session';
import { defaultConfig } from './config';
import type { Deps } from './deps';
import { MemoryStore } from './store/memory';
import { loggingNotifier } from './tables/notifier';

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

  await app.register(websocket);
  await registerSessions(app, deps);

  app.get('/api/health', () => ({ status: 'ok' }));
  authRoutes(app, deps);

  return app;
}
