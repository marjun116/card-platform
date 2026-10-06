import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

// Builds the app without starting it, so tests can call routes in memory.
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(websocket);

  app.get('/api/health', () => ({ status: 'ok' }));

  return app;
}
