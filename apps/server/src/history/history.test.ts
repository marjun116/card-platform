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
/** Hearts (three players by default): everyone on their own. */
const heartsScores = {
  teams: [0, 1, 2].map((seat) => ({ team: seat, players: [seat], score: 50 + seat })),
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
        finished: {
          endedAt,
          result: { winners: how.winners, scores: game === 'hearts' ? heartsScores : scores },
        },
      },
    );
  }
  return code;
}

async function history(offset?: number, filter: Record<string, string> = {}) {
  const query = new URLSearchParams(filter);
  if (offset !== undefined) query.set('offset', String(offset));
  const res = await server.app.inject({
    method: 'GET',
    url: `/api/history?${query.toString()}`,
    headers: withSession(me.token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ games: PastGame[]; more: boolean }>();
}

/** The codes of my past games matching `filter`. */
async function codes(filter: Record<string, string>): Promise<string[]> {
  return (await history(undefined, filter)).games.map((g) => g.code);
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
        seatTeams: [0, 1, 0, 1],
        winners: [],
        teams: null,
        lowestWins: false,
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
        seatTeams: [0, 1, 0, 1],
        winners: [0, 2],
        teams: [
          { team: 0, players: [0, 2], score: 520 },
          { team: 1, players: [1, 3], score: 310 },
        ],
        lowestWins: false,
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

  it('says when the lowest score wins, and gives players on their own a team each', async () => {
    await pastTable('hearts', 1, { winners: [0] });
    const [game] = (await history()).games;
    expect(game).toMatchObject({ lowestWins: true, seatTeams: [0, 1, 2] });
    expect(game?.teams?.[2]).toEqual({ team: 2, players: [2], score: 52 });
  });

  it('filters by game and outcome, across every page', async () => {
    const won = await pastTable('spades', 1, { winners: [0, 2] });
    const lost = await pastTable('spades', 2, { winners: [1, 3] });
    const early = await pastTable('spades', 3, 'ended early');
    const hearts = await pastTable('hearts', 4, { winners: [0] });
    expect(await codes({ game: 'spades' })).toEqual([early, lost, won]);
    expect(await codes({ game: 'hearts' })).toEqual([hearts]);
    expect(await codes({ outcome: 'won' })).toEqual([hearts, won]);
    expect(await codes({ outcome: 'lost' })).toEqual([lost]);
    expect(await codes({ outcome: 'early' })).toEqual([early]);
    expect(await codes({ game: 'spades', outcome: 'won' })).toEqual([won]);

    for (let i = 0; i < HISTORY_PAGE; i++) await pastTable('hearts', 10 + i, { winners: [1] });
    const first = await history(0, { outcome: 'lost' });
    expect(first.games).toHaveLength(HISTORY_PAGE);
    expect(first.more).toBe(true);
    const second = await history(HISTORY_PAGE, { outcome: 'lost' });
    expect(second.games.map((g) => g.code)).toEqual([lost]);
    expect(second.more).toBe(false);
  });

  it('lists the games in your history for the filter, most played first', async () => {
    await pastTable('hearts', 1, { winners: [0] });
    await pastTable('spades', 2, { winners: [0, 2] });
    await pastTable('spades', 3, 'ended early');
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/history/games',
      headers: withSession(me.token),
    });
    expect(res.json()).toEqual({
      games: [
        { game: { slug: 'spades', name: 'Spades' }, count: 2 },
        { game: { slug: 'hearts', name: 'Hearts' }, count: 1 },
      ],
    });
  });

  it('needs a user and a sensible page', async () => {
    expect((await server.app.inject({ method: 'GET', url: '/api/history' })).statusCode).toBe(401);
    expect((await server.app.inject({ method: 'GET', url: '/api/stats' })).statusCode).toBe(401);
    const games = await server.app.inject({ method: 'GET', url: '/api/history/games' });
    expect(games.statusCode).toBe(401);
    const bad = await server.app.inject({
      method: 'GET',
      url: '/api/history?offset=-1',
      headers: withSession(me.token),
    });
    expect(bad.statusCode).toBe(400);
    const outcome = await server.app.inject({
      method: 'GET',
      url: '/api/history?outcome=maybe',
      headers: withSession(me.token),
    });
    expect(outcome.statusCode).toBe(400);
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
