/**
 * Quick reactions: a fixed set (no words), shown to everyone seated at the
 * table during the game, one every few seconds per player, never saved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer } from '../testing';
import { TestClient } from '../testing/client';
import { listen, spadesTable } from '../testing/tables';
import { REACTION_COOLDOWN_MS } from './room';

let server: TestServer;
let baseUrl: string;
const clients: TestClient[] = [];

beforeEach(async () => {
  server = await testServer();
  baseUrl = await listen(server);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await server.app.close();
});

async function table(start = true) {
  const { code, players } = await spadesTable(server, baseUrl, { start });
  clients.push(...players.map((p) => p.client));
  return { code, players };
}

describe('reactions', () => {
  it('show at the sender’s seat for everyone at the table', async () => {
    const { players } = await table();
    const east = players[1];
    if (!east) throw new Error('Missing player');
    const marks = players.map((p) => p.client.mark());
    await east.client.ok({ type: 'react', reaction: 'laugh' });
    const got = await Promise.all(
      players.map((p, i) =>
        p.client.waitFor((m) => m.type === 'reaction', 'the reaction', marks[i]),
      ),
    );
    for (const m of got) expect(m).toEqual({ type: 'reaction', seat: 1, reaction: 'laugh' });
  });

  it('are only the fixed set, so no words can be sent', async () => {
    const { players } = await table();
    expect(
      await players[0]?.client.request({ type: 'react', reaction: 'hello there' } as never),
    ).toMatchObject({ type: 'error', code: 'BAD_MESSAGE' });
  });

  it('wait a few seconds between one player’s reactions', async () => {
    const { players } = await table();
    const [north, east] = players;
    if (!north || !east) throw new Error('Missing players');
    await north.client.ok({ type: 'react', reaction: 'thumbsUp' });
    expect(await north.client.request({ type: 'react', reaction: 'wow' })).toMatchObject({
      type: 'error',
      code: 'RATE_LIMITED',
    });
    // Someone else can still react.
    await east.client.ok({ type: 'react', reaction: 'wow' });
    server.advance(REACTION_COOLDOWN_MS);
    await north.client.ok({ type: 'react', reaction: 'goodGame' });
  });

  it('are for seated players during the game only', async () => {
    const { code, players } = await table(false);
    expect(await players[0]?.client.request({ type: 'react', reaction: 'thumbsUp' })).toMatchObject(
      { type: 'error', code: 'WRONG_STATUS' },
    );

    await players[0]?.client.ok({ type: 'start' });
    const watcher = await guest(server.app, 'Watcher');
    const client = await TestClient.connect(baseUrl, code, watcher.token, 'Watcher');
    clients.push(client);
    expect(await client.request({ type: 'react', reaction: 'thumbsUp' })).toMatchObject({
      type: 'error',
      code: 'NOT_SEATED',
    });
  });
});
