import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('server', () => {
  it('reports healthy', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
