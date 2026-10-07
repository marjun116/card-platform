/** Table routes, the lobby, host controls, protocol errors and turn nudges. */
import type { Move } from '@card-table/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer, withSession } from '../testing';
import { TestClient } from '../testing/client';
import { createTable, listen, type Player, playRandomly, spadesTable } from '../testing/tables';
import { MemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import type { TableInfo } from './protocol';

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

async function connect(code: string, token: string, name?: string) {
  const client = await TestClient.connect(baseUrl, code, token, name);
  clients.push(client);
  return client;
}

async function seated(options = {}, start = true) {
  const table = await spadesTable(server, baseUrl, { options, start });
  clients.push(...table.players.map((p) => p.client));
  return table;
}

/** The player whose turn it is, and the others. */
function turn(players: Player[]): { actor: Player; seat: number; others: Player[] } {
  const seat = players[0]?.client.lastGame?.toAct[0] as number;
  const actor = players[seat] as Player;
  return { actor, seat, others: players.filter((p) => p !== actor) };
}

describe('games and tables over HTTP', () => {
  it('lists the built-in games with their options', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/games' });
    const { games } = res.json<{ games: { slug: string; players: number[]; options: object }[] }>();
    const spades = games.find((g) => g.slug === 'spades');
    expect(spades?.players).toEqual([4]);
    expect(Object.keys(spades?.options ?? {})).toEqual([
      'nil',
      'blindNil',
      'targetScore',
      'mercyRule',
    ]);
  });

  it('lets a guest create a table, filling in default options', async () => {
    const { token, userId } = await guest(server.app, 'Host');
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/tables',
      body: { game: 'spades', options: { targetScore: 300 } },
      headers: withSession(token),
    });
    expect(res.statusCode).toBe(201);
    const { table } = res.json<{ table: TableInfo }>();
    expect(table).toMatchObject({
      game: { slug: 'spades', name: 'Spades', version: 1 },
      options: { nil: true, blindNil: false, targetScore: 300, mercyRule: true },
      playerCount: 4,
      teams: [
        [0, 2],
        [1, 3],
      ],
      status: 'lobby',
      hostId: userId,
    });
    expect(table.code).toMatch(/^[A-Z2-9]{10}$/);
    expect(table.seats.every((s) => s.user === null)).toBe(true);
    expect(res.body).not.toMatch(/seed/);
  });

  it('refuses bad table settings', async () => {
    const { token } = await guest(server.app, 'Host');
    const attempt = (body: object, headers = withSession(token)) =>
      server.app.inject({ method: 'POST', url: '/api/tables', body, headers });
    expect((await attempt({ game: 'spades' }, {} as never)).statusCode).toBe(401);
    expect((await attempt({ game: 'snap' })).statusCode).toBe(404);
    expect((await attempt({ game: 'spades', playerCount: 3 })).statusCode).toBe(400);
    expect((await attempt({ game: 'spades', options: { targetScore: 42 } })).statusCode).toBe(400);
    expect((await attempt({ game: 'spades', options: { jokers: true } })).statusCode).toBe(400);
    expect((await attempt({ game: 'spades', extra: 1 })).statusCode).toBe(400);
  });

  it('looks tables up by invite code, in any case', async () => {
    const { token } = await guest(server.app, 'Host');
    const code = await createTable(server, token);
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/tables/${code.toLowerCase()}`,
    });
    expect(res.json<{ table: TableInfo }>().table.code).toBe(code);
    expect((await server.app.inject({ method: 'GET', url: '/api/tables/NOPE' })).statusCode).toBe(
      404,
    );
  });

  it("lists a player's unfinished tables", async () => {
    const { code, players } = await seated();
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/tables/mine',
      headers: withSession(players[2]?.token ?? ''),
    });
    const { tables } = res.json<{ tables: TableInfo[] }>();
    expect(tables.map((t) => t.code)).toEqual([code]);
    expect(tables[0]?.seats.every((s) => s.connected)).toBe(true);
  });
});

/** A MemoryStore that answers every call after a delay, like a hosted database. */
function slowStore(delayMs: number): Store {
  const store = new MemoryStore();
  return new Proxy(store, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

describe('connecting', () => {
  it("doesn't lose messages sent while the server is still looking up the table", async () => {
    await server.app.close();
    server = await testServer({ store: slowStore(50) });
    baseUrl = await listen(server);
    const { token } = await guest(server.app, 'Host');
    const code = await createTable(server, token);
    const client = await connect(code, token);
    // Sent the moment the socket opens, before the server has loaded the table.
    await client.ok({ type: 'sit', seat: 0 });
    await client.ok({ type: 'stand' });
  });

  it('needs a session, a real table and our own origin', async () => {
    const { token } = await guest(server.app, 'Host');
    const code = await createTable(server, token);
    await expect(TestClient.connect(baseUrl, code, '')).rejects.toThrow();
    await expect(TestClient.connect(baseUrl, 'NOPE', token)).rejects.toThrow();
    await expect(
      TestClient.connect(baseUrl, code, token, 'x', { origin: 'http://evil.example' }),
    ).rejects.toThrow();
    const ok = await connect(code, token);
    await ok.waitFor((m) => m.type === 'table', 'table');
  });

  it('answers garbage with BAD_MESSAGE and keeps the connection', async () => {
    const { token } = await guest(server.app, 'Host');
    const client = await connect(await createTable(server, token), token);
    client.sendRaw('not json');
    client.sendRaw(JSON.stringify({ id: 7, type: 'teleport' }));
    client.sendRaw(JSON.stringify({ id: 8, type: 'sit', seat: 0, sneaky: true }));
    await client.waitFor((m) => m.type === 'error' && m.id === 8, 'error 8');
    const errors = client.messages.filter((m) => m.type === 'error');
    expect(errors.map((e) => e.type === 'error' && [e.id, e.code])).toEqual([
      [null, 'BAD_MESSAGE'],
      [7, 'BAD_MESSAGE'],
      [8, 'BAD_MESSAGE'],
    ]);
    await client.ok({ type: 'sit', seat: 0 });
  });
});

describe('the lobby', () => {
  it('seats players and tells everyone', async () => {
    const host = await guest(server.app, 'Host');
    const ann = await guest(server.app, 'Ann');
    const code = await createTable(server, host.token);
    const hostClient = await connect(code, host.token);
    const annClient = await connect(code, ann.token);

    await annClient.ok({ type: 'sit', seat: 2 });
    await hostClient.table((t) => t.seats[2]?.user?.displayName === 'Ann', 'Ann seated');
    expect(await annClient.request({ type: 'sit', seat: 3 })).toMatchObject({
      code: 'ALREADY_SEATED',
    });
    expect(await hostClient.request({ type: 'sit', seat: 2 })).toMatchObject({
      code: 'SEAT_TAKEN',
    });
    expect(await hostClient.request({ type: 'sit', seat: 4 })).toMatchObject({ code: 'BAD_SEAT' });

    await annClient.ok({ type: 'stand' });
    await hostClient.table((t) => t.seats[2]?.user === null, 'Ann stood');
    expect(await annClient.request({ type: 'stand' })).toMatchObject({ code: 'NOT_SEATED' });
  });

  it('shows who is connected', async () => {
    const { players } = await seated({}, false);
    const [north, east] = players as [Player, Player];
    const mark = north.client.mark();
    await east.client.close();
    clients.splice(clients.indexOf(east.client), 1);
    const update = await north.client.table((t) => !t.seats[1]?.connected, 'East left', mark);
    expect(update.table.seats.map((s) => s.connected)).toEqual([true, false, true, true]);
  });

  it('starts only when the host asks and every seat is filled', async () => {
    const host = await guest(server.app, 'Host');
    const code = await createTable(server, host.token);
    const hostClient = await connect(code, host.token);
    await hostClient.ok({ type: 'sit', seat: 0 });
    expect(await hostClient.request({ type: 'start' })).toMatchObject({ code: 'SEATS_EMPTY' });

    const { players } = await seated({}, false);
    const [north, east] = players as [Player, Player];
    expect(await east.client.request({ type: 'start' })).toMatchObject({ code: 'NOT_HOST' });
    await north.client.ok({ type: 'start' });
    expect(await north.client.request({ type: 'start' })).toMatchObject({ code: 'WRONG_STATUS' });
    expect(await east.client.request({ type: 'stand' })).toMatchObject({ code: 'WRONG_STATUS' });
    for (const [seat, p] of players.entries()) {
      const game = await p.client.game(0);
      expect(game.view.you).toBe(seat);
      expect(game.toAct).toHaveLength(1);
    }
  });
});

describe('moves', () => {
  it('rejects moves out of turn, stale moves and moves from people without a seat', async () => {
    const { code, players } = await seated();
    const { actor, others } = turn(players);
    const legal = actor.client.lastGame?.legalMoves[0] as Move;

    const other = others[0] as Player;
    expect(await other.client.request({ type: 'move', seq: 0, move: legal })).toMatchObject({
      code: 'ILLEGAL_MOVE',
    });
    expect(await actor.client.request({ type: 'move', seq: 5, move: legal })).toMatchObject({
      code: 'STALE_SEQ',
    });
    const watcher = await guest(server.app, 'Watcher');
    const watching = await connect(code, watcher.token);
    expect(await watching.request({ type: 'move', seq: 0, move: legal })).toMatchObject({
      code: 'NOT_SEATED',
    });

    // A double click: the second copy is stale.
    const first = actor.client.request({ type: 'move', seq: 0, move: legal });
    const second = actor.client.request({ type: 'move', seq: 0, move: legal });
    expect(await first).toEqual({ type: 'ack', id: expect.anything() as unknown });
    expect(await second).toMatchObject({ code: 'STALE_SEQ' });
  });
});

describe('host controls', () => {
  it('pauses and resumes', async () => {
    const { players } = await seated();
    const [north, east] = players as [Player, Player];
    const { actor } = turn(players);
    expect(await east.client.request({ type: 'pause' })).toMatchObject({ code: 'NOT_HOST' });
    const mark = actor.client.mark();
    await north.client.ok({ type: 'pause' });
    const paused = await actor.client.waitFor(
      (m): m is Extract<typeof m, { type: 'game' }> => m.type === 'game',
      'paused view',
      mark,
    );
    expect(paused?.legalMoves).toEqual([]);
    expect(paused?.toAct).toEqual([]);
    const legal = (await actor.client.game(0)).legalMoves[0] as Move;
    expect(await actor.client.request({ type: 'move', seq: 0, move: legal })).toMatchObject({
      code: 'WRONG_STATUS',
      message: 'The game is paused',
    });

    const resumeMark = actor.client.mark();
    const eastMark = east.client.mark();
    await north.client.ok({ type: 'resume' });
    const resumed = await actor.client.waitFor(
      (m): m is Extract<typeof m, { type: 'game' }> => m.type === 'game',
      'resumed view',
      resumeMark,
    );
    expect(resumed.legalMoves.length).toBeGreaterThan(0);
    await east.client.table((t) => t.status === 'playing', 'playing', eastMark);
    await playRandomly(players, 'after-pause', { maxMoves: 3 });
  });

  it('ends a table without recording a result', async () => {
    const { code, players } = await seated();
    await playRandomly(players, 'end', { maxMoves: 5 });
    const [north] = players as [Player];
    const { actor } = turn(players);
    await north.client.ok({ type: 'end' });
    await north.client.table((t) => t.status === 'abandoned', 'abandoned');
    expect(
      await actor.client.request({ type: 'move', seq: 5, move: { type: 'endTurn' } }),
    ).toMatchObject({ code: 'WRONG_STATUS' });
    const table = await server.store.getTableByInviteCode(code);
    expect(table?.status).toBe('abandoned');
    expect(await server.store.getResult(table?.id ?? '')).toBeNull();
    expect(await north.client.request({ type: 'end' })).toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('frees the seat of a player who left, and someone else takes over', async () => {
    const { code, players } = await seated();
    await playRandomly(players, 'free', { maxMoves: 6 });
    const [north, east] = players as [Player, Player];
    expect(await north.client.request({ type: 'freeSeat', seat: 1 })).toMatchObject({
      code: 'PLAYER_CONNECTED',
    });
    const mark = north.client.mark();
    await east.client.close();
    clients.splice(clients.indexOf(east.client), 1);
    await north.client.table((t) => !t.seats[1]?.connected, 'East left', mark);
    await north.client.ok({ type: 'freeSeat', seat: 1 });

    const sub = await guest(server.app, 'Sub');
    const subClient = await connect(code, sub.token);
    await subClient.ok({ type: 'sit', seat: 1 });
    const view = await subClient.game(6);
    expect(view.view.you).toBe(1);
    expect(view.view.zones['hand@1']?.kind).toBe('cards');
    players[1] = { ...east, ...sub, name: 'Sub', client: subClient };
    await playRandomly(players, 'free-2', { maxMoves: 6 });
  });
});

describe('turn nudges', () => {
  it('lets a player nudge whoever is holding up the game, not too often', async () => {
    const { players } = await seated();
    const { actor, seat, others } = turn(players);
    const nudger = others[0] as Player;

    await nudger.client.ok({ type: 'nudge', seat });
    expect(server.nudges).toEqual([
      expect.objectContaining({ seat, userId: actor.userId, reason: 'manual' }),
    ]);
    await actor.client.waitFor((m) => m.type === 'nudged', 'nudged');

    expect(await nudger.client.request({ type: 'nudge', seat })).toMatchObject({
      code: 'RATE_LIMITED',
    });
    server.advance(5 * 60_000);
    await nudger.client.ok({ type: 'nudge', seat });
    expect(server.nudges).toHaveLength(2);

    const notTheirTurn = players.indexOf(nudger);
    expect(await actor.client.request({ type: 'nudge', seat: notTheirTurn })).toMatchObject({
      code: 'NOT_THEIR_TURN',
    });
    expect(await actor.client.request({ type: 'nudge', seat })).toMatchObject({
      code: 'NOT_THEIR_TURN',
    });
  });

  it('notifies a player who has been away for their whole turn, once per turn', async () => {
    const { players } = await seated();
    const { actor, seat } = turn(players);

    // Still connected: no nudge, however long it takes.
    server.advance(13 * 3_600_000);
    await server.app.rooms.sweepIdleTurns();
    expect(server.nudges).toEqual([]);

    const other = players.find((p) => p !== actor) as Player;
    const mark = other.client.mark();
    await actor.client.close();
    clients.splice(clients.indexOf(actor.client), 1);
    await other.client.table((t) => !t.seats[seat]?.connected, 'actor left', mark);
    await server.app.rooms.sweepIdleTurns();
    expect(server.nudges).toEqual([
      expect.objectContaining({ seat, userId: actor.userId, reason: 'idle' }),
    ]);
    await server.app.rooms.sweepIdleTurns();
    expect(server.nudges).toHaveLength(1);
  });

  it("doesn't nudge before the limit, or at paused tables", async () => {
    const { players } = await seated();
    await Promise.all(clients.splice(0).map((c) => c.close()));
    server.advance(11 * 3_600_000);
    await server.app.rooms.sweepIdleTurns();
    expect(server.nudges).toEqual([]);

    const table = (await server.store.listOpenTables(players[0]?.userId ?? ''))[0];
    await server.store.updateTable(table?.id ?? '', { status: 'paused' });
    server.advance(2 * 3_600_000);
    await server.app.rooms.sweepIdleTurns();
    expect(server.nudges).toEqual([]);
  });
});
