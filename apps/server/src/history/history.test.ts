/** Game history and stats over HTTP. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer, withSession } from '../testing';
import type { GameStats, PastGame, TableInfo } from '../tables/protocol';
import { HISTORY_PAGE } from './routes';

let server: TestServer;
let me: { token: string; userId: string };

beforeEach(async () => {
  server = await testServer();
  me = await guest(server.app, 'Me');
});
afterEach(() => server.app.close());

const scores = {
  teams: [
    { team: 0, players: [0, 2], score: 520 },
    { team: 1, players: [1, 3], score: 310 },
  ],
  players: [],
};

/**
 * A table of `game` with me in seat `mySeat` and a bot in seat 1, ended at
 * minute `minute`: finished with `winners`, or ended early by the host.
 */
async function pastTable(
  game: string,
  minute: number,
  how: { winners: number[] } | 'ended early',
  mySeat = 0,
): Promise<string> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/tables',
    body: { game },
    headers: withSession(me.token),
  });
  const { code } = res.json<{ table: TableInfo }>().table;
  const { store } = server;
  const table = await store.getTableByInviteCode(code);
  if (!table) throw new Error('No table');
  await store.takeSeat(table.id, mySeat, me.userId);
  await store.takeSeat(table.id, 1, (await store.botUser(2)).id);
  const startedAt = new Date(Date.UTC(2026, 9, 10, 12, 0));
  const endedAt = new Date(Date.UTC(2026, 9, 10, 12, minute));
  await store.updateTable(table.id, { status: 'playing', startedAt });
  if (how === 'ended early') {
    await store.updateTable(table.id, { status: 'abandoned', endedAt });
  } else {
    await store.recordMove(
      table.id,
      0,
      { player: 0, type: 'endTurn' },
      {
        toAct: [],
        turnSince: null,
        finished: { endedAt, result: { winners: how.winners, scores } },
      },
    );
  }
  return code;
}

async function history(offset?: number) {
  const res = await server.app.inject({
    method: 'GET',
    url: `/api/history${offset === undefined ? '' : `?offset=${offset}`}`,
    headers: withSession(me.token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ games: PastGame[]; more: boolean }>();
}

async function stats(): Promise<GameStats[]> {
  const res = await server.app.inject({
    method: 'GET',
    url: '/api/stats',
    headers: withSession(me.token),
  });
  return res.json<{ stats: GameStats[] }>().stats;
}

describe('game history', () => {
  it('lists the games you sat at that are over, newest first', async () => {
    const won = await pastTable('spades', 10, { winners: [0, 2] });
    const early = await pastTable('spades', 20, 'ended early', 3);

    const { games, more } = await history();
    expect(more).toBe(false);
    expect(games).toEqual([
      {
        code: early,
        game: { slug: 'spades', name: 'Spades' },
        status: 'abandoned',
        endedAt: '2026-10-10T12:20:00.000Z',
        seats: [
          { seat: 1, displayName: 'Bot 2', bot: true },
          { seat: 3, displayName: 'Me', bot: false },
        ],
        you: 3,
        winners: [],
        teams: null,
      },
      {
        code: won,
        game: { slug: 'spades', name: 'Spades' },
        status: 'finished',
        endedAt: '2026-10-10T12:10:00.000Z',
        seats: [
          { seat: 0, displayName: 'Me', bot: false },
          { seat: 1, displayName: 'Bot 2', bot: true },
        ],
        you: 0,
        winners: [0, 2],
        teams: [
          { players: [0, 2], score: 520 },
          { players: [1, 3], score: 310 },
        ],
      },
    ]);
  });

  it(`comes ${HISTORY_PAGE} games at a time`, async () => {
    for (let i = 0; i <= HISTORY_PAGE; i++) await pastTable('hearts', i, { winners: [1] });
    const first = await history();
    expect(first.games).toHaveLength(HISTORY_PAGE);
    expect(first.more).toBe(true);
    const second = await history(HISTORY_PAGE);
    expect(second.games).toHaveLength(1);
    expect(second.more).toBe(false);
    expect(second.games[0]?.endedAt).toBe('2026-10-10T12:00:00.000Z');
  });

  it('needs a user and a sensible page', async () => {
    expect((await server.app.inject({ method: 'GET', url: '/api/history' })).statusCode).toBe(401);
    expect((await server.app.inject({ method: 'GET', url: '/api/stats' })).statusCode).toBe(401);
    const bad = await server.app.inject({
      method: 'GET',
      url: '/api/history?offset=-1',
      headers: withSession(me.token),
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('stats', () => {
  it('counts finished games played and won per game, leaving out games ended early', async () => {
    await pastTable('spades', 1, { winners: [0, 2] });
    await pastTable('spades', 2, { winners: [1, 3] });
    await pastTable('spades', 3, { winners: [1, 3] }, 2);
    await pastTable('spades', 4, 'ended early');
    await pastTable('hearts', 5, { winners: [0] });
    expect(await stats()).toEqual([
      { game: { slug: 'spades', name: 'Spades' }, played: 3, won: 1 },
      { game: { slug: 'hearts', name: 'Hearts' }, played: 1, won: 1 },
    ]);
  });

  it('is empty before your first game', async () => {
    expect(await stats()).toEqual([]);
  });
});
