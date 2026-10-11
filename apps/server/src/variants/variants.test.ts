/** Saved variants over HTTP. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer, withSession } from '../testing';
import type { VariantInfo } from '../tables/protocol';
import { MAX_VARIANTS } from './routes';

let server: TestServer;

beforeEach(async () => {
  server = await testServer();
});
afterEach(() => server.app.close());

function save(token: string, body: object) {
  return server.app.inject({
    method: 'POST',
    url: '/api/variants',
    body,
    headers: withSession(token),
  });
}

async function saved(token: string, body: object): Promise<VariantInfo> {
  const res = await save(token, body);
  expect(res.statusCode).toBe(201);
  return res.json<{ variant: VariantInfo }>().variant;
}

async function get(code: string, token?: string) {
  return server.app.inject({
    method: 'GET',
    url: `/api/variants/${code}`,
    headers: token ? withSession(token) : {},
  });
}

async function mine(token: string): Promise<VariantInfo[]> {
  const res = await server.app.inject({
    method: 'GET',
    url: '/api/variants/mine',
    headers: withSession(token),
  });
  return res.json<{ variants: VariantInfo[] }>().variants;
}

describe('saved variants', () => {
  it('saves a name with the house rules, filling in the defaults', async () => {
    const { token, userId } = await guest(server.app, 'Grandma');
    const variant = await saved(token, {
      game: 'spades',
      name: "  Grandma's Spades ",
      options: { targetScore: 300, blindNil: true },
    });
    expect(variant).toEqual({
      code: expect.stringMatching(/^[A-Z2-9]{10}$/) as string,
      name: "Grandma's Spades",
      game: { slug: 'spades', name: 'Spades' },
      options: { nil: true, blindNil: true, targetScore: 300, mercyRule: true },
      playerCount: 4,
      owner: { id: userId, displayName: 'Grandma' },
    });
    expect((await mine(token)).map((v) => v.code)).toEqual([variant.code]);
  });

  it('refuses settings a table would refuse', async () => {
    const { token } = await guest(server.app, 'A');
    expect((await save(token, { game: 'nope', name: 'X' })).statusCode).toBe(404);
    const count = await save(token, { game: 'spades', name: 'X', playerCount: 3 });
    expect(count.statusCode).toBe(400);
    expect(count.json<{ error: string }>().error).toBe('Spades is for 4 players');
    const option = await save(token, { game: 'spades', name: 'X', options: { targetScore: 7 } });
    expect(option.statusCode).toBe(400);
    expect((await save(token, { game: 'spades', name: '   ' })).statusCode).toBe(400);
    expect((await save(token, { game: 'spades', name: 'x'.repeat(61) })).statusCode).toBe(400);
    expect(await mine(token)).toEqual([]);
  });

  it('needs a user to save, but anyone with the code can see one', async () => {
    const anonymous = await server.app.inject({
      method: 'POST',
      url: '/api/variants',
      body: { game: 'spades', name: 'X' },
    });
    expect(anonymous.statusCode).toBe(401);

    const { token } = await guest(server.app, 'A');
    const variant = await saved(token, { game: 'hearts', name: 'Ours', playerCount: 3 });
    const res = await get(variant.code.toLowerCase());
    expect(res.statusCode).toBe(200);
    expect(res.json<{ variant: VariantInfo }>().variant).toEqual(variant);
    expect((await get('NOSUCHCODE')).statusCode).toBe(404);
  });

  it('lets only the owner delete a variant', async () => {
    const owner = await guest(server.app, 'Owner');
    const other = await guest(server.app, 'Other');
    const variant = await saved(owner.token, { game: 'spades', name: 'Ours' });
    const remove = (token: string) =>
      server.app.inject({
        method: 'DELETE',
        url: `/api/variants/${variant.code}`,
        headers: withSession(token),
      });

    expect((await remove(other.token)).statusCode).toBe(403);
    expect((await remove(owner.token)).statusCode).toBe(200);
    expect((await get(variant.code)).statusCode).toBe(404);
    expect((await remove(owner.token)).statusCode).toBe(404);
  });

  it('fits saved options to the current game file', async () => {
    const { token, userId } = await guest(server.app, 'A');
    await saved(token, { game: 'spades', name: 'Current' });
    const [current] = await server.store.listVariants(userId);
    // As if saved from an older spades file: an option since removed, a value no longer
    // offered and a player count no longer allowed.
    await server.store.createVariant({
      code: 'OLDRULES',
      ownerId: userId,
      definitionId: current?.definitionId ?? '',
      name: 'Old rules',
      options: { gone: true, targetScore: 250, nil: false },
      playerCount: 6,
    });
    const res = await get('OLDRULES');
    expect(res.json<{ variant: VariantInfo }>().variant).toMatchObject({
      options: { nil: false, blindNil: false, targetScore: 500, mercyRule: true },
      playerCount: 4,
    });
  });

  it(`keeps at most ${MAX_VARIANTS} per person`, async () => {
    const { token } = await guest(server.app, 'A');
    for (let i = 0; i < MAX_VARIANTS; i++) await saved(token, { game: 'spades', name: `V${i}` });
    const res = await save(token, { game: 'spades', name: 'One more' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/Delete one first/);
  });
});
