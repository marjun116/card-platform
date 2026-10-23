/**
 * Rematch: once a game is over, any seated player can start a new table with
 * the same game and options and everyone back in the same seats.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer, withSession } from '../testing';
import { TestClient } from '../testing/client';
import { listen, playRandomly, spadesTable } from '../testing/tables';

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

/** Four guests play spades to the end. */
async function finishedTable() {
  const { code, players } = await spadesTable(server, baseUrl);
  clients.push(...players.map((p) => p.client));
  await playRandomly(players, 'rematch');
  await Promise.all(players.map((p) => p.client.table((t) => t.status === 'finished')));
  return { code, players };
}

describe('rematch', () => {
  it("can't start before the game is over", async () => {
    const { players } = await spadesTable(server, baseUrl);
    clients.push(...players.map((p) => p.client));
    expect(await players[1]?.client.request({ type: 'rematch' })).toMatchObject({
      type: 'error',
      code: 'WRONG_STATUS',
    });
  });

  it('starts a new table with everyone in the same seats, hosted by whoever asked', async () => {
    const { code, players } = await finishedTable();
    const [north, east] = players;
    if (!north || !east) throw new Error('Missing players');
    const marks = players.map((p) => p.client.mark());
    await east.client.ok({ type: 'rematch' });

    // Everyone at the old table hears where the rematch is, and who started it.
    const updates = await Promise.all(
      players.map((p, i) => p.client.table((t) => t.rematch !== null, 'the rematch', marks[i])),
    );
    const rematch = updates[0]?.table.rematch;
    expect(rematch?.by).toBe(1);
    for (const u of updates) expect(u.table.rematch).toEqual(rematch);

    const old = await server.store.getTableByInviteCode(code);
    const fresh = await server.store.getTableByInviteCode(rematch?.code ?? '');
    expect(fresh).toMatchObject({
      status: 'lobby',
      hostId: east.userId,
      gameVersionId: old?.gameVersionId,
      options: old?.options,
      playerCount: 4,
    });
    expect(fresh?.seed).not.toBe(old?.seed);
    expect(fresh?.seats.map((s) => [s.seat, s.userId])).toEqual(
      players.map((p, seat) => [seat, p.userId]),
    );

    // Asking again joins the same rematch rather than starting another.
    await north.client.ok({ type: 'rematch' });
    expect((await server.store.getTableByInviteCode(code))?.rematch?.inviteCode).toBe(
      rematch?.code,
    );
    expect(north.client.lastTable?.rematch).toEqual(rematch);

    // Someone who doesn't want to play can stand up in the new lobby.
    const again = await TestClient.connect(baseUrl, rematch?.code ?? '', north.token, 'North');
    clients.push(again);
    await again.ok({ type: 'stand' });
    expect(again.lastTable?.seats[0]?.user).toBeNull();
  });

  it("can't be started by someone who wasn't playing", async () => {
    const { code } = await finishedTable();
    const watcher = await guest(server.app, 'Watcher');
    const client = await TestClient.connect(baseUrl, code, watcher.token, 'Watcher');
    clients.push(client);
    expect(await client.request({ type: 'rematch' })).toMatchObject({
      type: 'error',
      code: 'NOT_SEATED',
    });
  });

  it('can start again once the rematch table is deleted', async () => {
    const { code, players } = await finishedTable();
    const east = players[1];
    if (!east) throw new Error('Missing player');
    await east.client.ok({ type: 'rematch' });
    const first = east.client.lastTable?.rematch?.code ?? '';
    const deleted = await server.app.inject({
      method: 'DELETE',
      url: `/api/tables/${first}`,
      headers: withSession(east.token),
    });
    expect(deleted.statusCode).toBeLessThan(300);
    await east.client.ok({ type: 'rematch' });
    const second = (await server.store.getTableByInviteCode(code))?.rematch?.inviteCode;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});
