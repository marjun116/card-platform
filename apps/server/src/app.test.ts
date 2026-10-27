import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp, redactSecrets } from './app';
import { defaultConfig } from './config';

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

  it('serves the built website, with every page address getting index.html', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'card-table-web-'));
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Card Table</title>');
    writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    const app = await buildApp({ config: { ...defaultConfig, webDir } });
    try {
      for (const url of ['/', '/t/K7QX2M9PLA', '/games/spades/rules']) {
        const page = await app.inject({ method: 'GET', url });
        expect(page.statusCode, url).toBe(200);
        expect(page.body).toContain('<title>Card Table</title>');
        expect(page.headers['cache-control']).toBe('no-cache');
      }
      // Link previews may only ask for the headers.
      expect((await app.inject({ method: 'HEAD', url: '/t/K7QX2M9PLA' })).statusCode).toBe(200);
      const script = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
      expect(script.body).toBe('console.log(1)');
      expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');

      // The API is unchanged, and unknown API addresses aren't pages.
      expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({
        status: 'ok',
      });
      const missing = await app.inject({ method: 'GET', url: '/api/nothing' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: 'Not found' });
      expect((await app.inject({ method: 'POST', url: '/t/K7QX2M9PLA' })).statusCode).toBe(404);
    } finally {
      await app.close();
      rmSync(webDir, { recursive: true });
    }
  });
});
