import { describe, expect, it } from 'vitest';
import { buildApp, redactSecrets } from './app';

describe('server', () => {
  it('reports healthy', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('hides the details of unexpected errors from clients', async () => {
    const app = await buildApp();
    app.get('/api/boom', () => {
      throw new Error('connection to db.internal:5432 failed for user admin');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('db.internal');
    expect(res.json()).toEqual({ error: 'Something went wrong on the server' });
    await app.close();
  });

  it('keeps sign-in tokens out of logged URLs', () => {
    expect(redactSecrets('/api/auth/verify?token=abc123')).toBe(
      '/api/auth/verify?token=[redacted]',
    );
    expect(redactSecrets('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=[redacted]&b=2');
    expect(redactSecrets('/api/tables/ABC')).toBe('/api/tables/ABC');
  });
});
