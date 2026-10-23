/**
 * "Show all hands": a finished round with every hand face up, for the table's
 * players only, and never a round still being played.
 */
import type { RoundReplay } from '@card-table/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer, withSession } from '../testing';
import { listen, type Player, playRandomly, spadesTable } from '../testing/tables';

let server: TestServer;
let players: Player[];
let code: string;

beforeEach(async () => {
  server = await testServer();
  const table = await spadesTable(server, await listen(server));
  players = table.players;
  code = table.code;
});

afterEach(async () => {
  await Promise.all(players.map((p) => p.client.close()));
  await server.app.close();
});

const view = () => players[0]?.client.lastGame?.view;

function getRound(round: number | string, token = players[0]?.token) {
  return server.app.inject({
    method: 'GET',
    url: `/api/tables/${code}/rounds/${round}`,
    headers: token ? withSession(token) : {},
  });
}

/** Plays one move at a time until `done` (never closing the round's scores). */
async function playUntil(done: () => boolean): Promise<void> {
  while (!done()) {
    if ((await playRandomly(players, `replay-${view()?.log.length}`, { maxMoves: 1 })) === 0) {
      throw new Error('Nobody could move');
    }
  }
}

describe('GET /api/tables/:code/rounds/:round', () => {
  it('gives nothing while the round is being played', async () => {
    await playUntil(() => (view()?.log.length ?? 0) >= 10);
    const res = await getRound(1);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/"(?:10|[2-9JQKA])[CDHS]\.\d+"/);
  });

  it('plays back a finished round with every hand face up', async () => {
    await playUntil(() => view()?.status === 'betweenRounds');
    const res = await getRound(1);
    expect(res.statusCode).toBe(200);
    const { replay } = res.json<{ replay: RoundReplay }>();
    expect(replay.round).toBe(1);
    expect(replay.moves).toHaveLength(view()?.log.length ?? -1);
    expect(replay.frames).toHaveLength(replay.moves.length + 1);
    const hands = Object.entries(replay.frames[0]?.zones ?? {}).filter(([k]) =>
      k.startsWith('hand@'),
    );
    expect(hands.map(([, zone]) => zone.kind === 'cards' && zone.cards.length)).toEqual([
      13, 13, 13, 13,
    ]);
    // The game file and the seed stay on the server.
    expect(res.body).not.toContain('"seed"');
    expect(res.body).not.toContain('"rng"');
  });

  it('keeps the next round to itself until it is over too', async () => {
    await playUntil(() => view()?.status === 'betweenRounds');
    // Everyone closes the scores; the next round is dealt and a card or two played.
    await playRandomly(players, 'replay-next', { maxMoves: 6 });
    expect(view()?.round).toBe(2);
    expect((await getRound(1)).statusCode).toBe(200);
    expect((await getRound(2)).statusCode).toBe(404);
    expect((await getRound(3)).statusCode).toBe(404);
  });

  it("is only for the table's players", async () => {
    await playUntil(() => view()?.status === 'betweenRounds');
    const stranger = await guest(server.app, 'Stranger');
    expect((await getRound(1, stranger.token)).statusCode).toBe(403);
    expect((await getRound(1, '')).statusCode).toBe(401);
  });

  it('refuses a round that is not a number', async () => {
    expect((await getRound('first')).statusCode).toBe(400);
    expect((await getRound(0)).statusCode).toBe(400);
  });
});
