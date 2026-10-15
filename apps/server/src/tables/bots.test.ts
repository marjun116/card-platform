/**
 * Bots at tables: the host seats them, they play their turns through the
 * same checks as anyone, and they take over from a player who left.
 */
import { type Move, randomInt, seedRng } from '@card-table/engine';
import { builtInGames } from '@card-table/games';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer } from '../testing';
import { TestClient } from '../testing/client';
import { createTable, listen, playRandomly, spadesTable } from '../testing/tables';
import type { ServerMessage } from './protocol';
import { tableInfo } from './room';

type GameMessage = Extract<ServerMessage, { type: 'game' }>;

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

/** A spades table hosted by one guest (seat 0); returns the host's client and the code. */
async function hostedTable() {
  const host = await guest(server.app, 'Host');
  const code = await createTable(server, host.token);
  const client = await TestClient.connect(baseUrl, code, host.token, 'Host');
  clients.push(client);
  await client.ok({ type: 'sit', seat: 0 });
  return { client, code, token: host.token };
}

/**
 * Plays the host's turns with random legal moves while the bots play theirs,
 * closing each round's scores as a person would, until the game ends. Returns
 * the last game message.
 */
async function playAgainstBots(client: TestClient, seed: string): Promise<GameMessage> {
  const rng = seedRng(seed);
  let next = 0;
  let rounds = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const game = await client.waitFor(
      (m): m is GameMessage =>
        m.type === 'game' &&
        m.seq >= next &&
        (m.view.status === 'over' ||
          m.view.history.length > rounds ||
          m.legalMoves.some((l) => l.type !== 'lookAtHand')),
      `seat 0's turn after move ${next}`,
    );
    if (game.view.status === 'over') return game;
    if (game.view.history.length > rounds) {
      rounds = game.view.history.length;
      await client.ok({ type: 'roundSeen' });
      continue;
    }
    const moves = game.legalMoves.filter((m) => m.type !== 'lookAtHand');
    const move = moves[randomInt(rng, moves.length)] as Move;
    await client.ok({ type: 'move', seq: game.seq, move });
    next = game.seq + 1;
  }
  throw new Error('The game never ended');
}

describe('bots at a table', () => {
  it('play a whole game of spades against a person', async () => {
    const { client, code } = await hostedTable();
    for (const seat of [1, 2, 3]) await client.ok({ type: 'addBot', seat });
    const table = client.lastTable;
    expect(table?.botsAllowed).toBe(true);
    expect(table?.seats.slice(1).map((s) => [s.user?.displayName, s.bot, s.connected])).toEqual([
      ['Bot 2', true, true],
      ['Bot 3', true, true],
      ['Bot 4', true, true],
    ]);
    await client.ok({ type: 'start' });

    const last = await playAgainstBots(client, 'vs-bots');
    expect(last.view.status).toBe('over');
    const saved = await server.store.getTableByInviteCode(code);
    expect(saved?.status).toBe('finished');
    // Every seat played: the bots' moves are in the log like anyone's.
    const moves = await server.store.listMoves(saved?.id as string);
    expect(new Set(moves.map((m) => m.player))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('can only be seated and removed by the host, and stay once the game starts', async () => {
    const { client, code } = await hostedTable();
    const other = await guest(server.app, 'Other');
    const otherClient = await TestClient.connect(baseUrl, code, other.token, 'Other');
    clients.push(otherClient);
    expect(await otherClient.request({ type: 'addBot', seat: 1 })).toMatchObject({
      code: 'NOT_HOST',
    });
    await client.ok({ type: 'addBot', seat: 1 });
    expect(await client.request({ type: 'addBot', seat: 1 })).toMatchObject({
      code: 'SEAT_TAKEN',
    });
    expect(await client.request({ type: 'removeBot', seat: 0 })).toMatchObject({
      code: 'BAD_SEAT',
    });
    await client.ok({ type: 'removeBot', seat: 1 });
    expect(client.lastTable?.seats[1]?.user).toBeNull();

    for (const seat of [1, 2, 3]) await client.ok({ type: 'addBot', seat });
    await client.ok({ type: 'start' });
    expect(await client.request({ type: 'removeBot', seat: 1 })).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it("don't get nudged", async () => {
    const { client } = await hostedTable();
    for (const seat of [1, 2, 3]) await client.ok({ type: 'addBot', seat });
    await client.ok({ type: 'start' });
    const game = await client.waitFor(
      (m): m is GameMessage => m.type === 'game' && !m.toAct.includes(0),
      "a bot's turn",
    );
    const botSeat = game.toAct[0] as number;
    expect(await client.request({ type: 'nudge', seat: botSeat })).toMatchObject({
      code: 'NOT_THEIR_TURN',
    });
  });
});

describe('bots after a round ends', () => {
  /** Host and three bots, played (randomly by the host) until the first round is over. */
  async function firstRoundOver(seed: string) {
    const { client, code, token } = await hostedTable();
    for (const seat of [1, 2, 3]) await client.ok({ type: 'addBot', seat });
    await client.ok({ type: 'start' });
    const rng = seedRng(seed);
    let next = 0;
    for (let guard = 0; guard < 500; guard++) {
      const game = await client.waitFor(
        (m): m is GameMessage =>
          m.type === 'game' &&
          m.seq >= next &&
          (m.view.history.length > 0 || m.legalMoves.some((l) => l.type !== 'lookAtHand')),
        `seat 0's turn after move ${next}`,
      );
      if (game.view.history.length > 0) return { client, code, token, seq: game.seq, game };
      const moves = game.legalMoves.filter((m) => m.type !== 'lookAtHand');
      await client.ok({
        type: 'move',
        seq: game.seq,
        move: moves[randomInt(rng, moves.length)] as Move,
      });
      next = game.seq + 1;
    }
    throw new Error('The round never ended');
  }

  /** Gives the bots time to move, if they were going to. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  it('wait, with the next hand undealt, until everyone has closed the round scores', async () => {
    const { client, code, seq, game } = await firstRoundOver('reading');
    expect(client.lastTable?.readingScores).toEqual([0]);
    // The round's last trick is still on the table, and nobody can move.
    expect(game.view.status).toBe('betweenRounds');
    expect(game.view.lastTrick?.plays).toHaveLength(4);
    expect(game.toAct).toEqual([]);
    expect(game.legalMoves).toEqual([]);
    expect(await client.request({ type: 'nudge', seat: 1 })).toMatchObject({
      code: 'NOT_THEIR_TURN',
    });
    await settle();
    expect(client.lastGame).toBe(game);
    // Saved as it will be once dealt, so a restart (which deals at once) agrees.
    const saved = await server.store.getTableByInviteCode(code);
    expect(saved?.toAct).toHaveLength(1);

    const from = client.mark();
    await client.ok({ type: 'roundSeen' });
    await client.table((t) => t.readingScores.length === 0, 'scores closed', from);
    const dealt = await client.waitFor(
      (m): m is GameMessage => m.type === 'game' && m.view.status === 'inProgress',
      'the next deal',
      from,
    );
    expect(dealt.view.round).toBe(2);
    expect(dealt.seq).toBe(seq);
    expect(dealt.toAct).toHaveLength(1);
    // If a bot starts the new round, it now plays.
    if (!dealt.toAct.includes(0)) await client.game(seq + 1);
  });

  it('deal the next round when the player reading the scores leaves the table', async () => {
    const { client, code, token } = await firstRoundOver('leaving');
    // Someone else still has the table open (with nobody there, bots wait anyway).
    const other = await guest(server.app, 'Other');
    const otherClient = await TestClient.connect(baseUrl, code, other.token, 'Other');
    clients.push(otherClient);
    const from = otherClient.mark();
    await client.close();
    clients.splice(clients.indexOf(client), 1);
    await otherClient.table((t) => t.readingScores.length === 0, 'reader gone', from);
    // Coming back, the host finds the next round dealt.
    const back = await TestClient.connect(baseUrl, code, token, 'Host');
    clients.push(back);
    const game = await back.waitFor((m): m is GameMessage => m.type === 'game', 'a view');
    expect(game.view.status).toBe('inProgress');
    expect(game.view.round).toBe(2);
  });

  it('only take roundSeen from a seated player', async () => {
    const { code } = await hostedTable();
    const other = await guest(server.app, 'Other');
    const otherClient = await TestClient.connect(baseUrl, code, other.token, 'Other');
    clients.push(otherClient);
    expect(await otherClient.request({ type: 'roundSeen' })).toMatchObject({ code: 'NOT_SEATED' });
  });
});

describe('a bot taking over from a player who left', () => {
  it('needs the player gone, then plays their turns', async () => {
    const { code, players } = await spadesTable(server, baseUrl);
    clients.push(...players.map((p) => p.client));
    await playRandomly(players, 'before', { maxMoves: 2 });
    const [north, east] = players;
    if (!north || !east) throw new Error('Missing players');
    expect(await north.client.request({ type: 'replaceWithBot', seat: 1 })).toMatchObject({
      code: 'PLAYER_CONNECTED',
    });

    const mark = north.client.mark();
    await east.client.close();
    clients.splice(clients.indexOf(east.client), 1);
    await north.client.table((t) => !t.seats[1]?.connected, 'East left', mark);
    await north.client.ok({ type: 'replaceWithBot', seat: 1 });
    expect(north.client.lastTable?.seats[1]).toMatchObject({ bot: true, connected: true });

    // The others play on; the bot plays seat 1 whenever it's due.
    const people = players.filter((p) => p !== east);
    const rng = seedRng('after');
    const table = await server.store.getTableByInviteCode(code);
    for (let made = 0; made < 40;) {
      const game = north.client.lastGame as GameMessage;
      const seat = game.toAct[0];
      if (seat === undefined) break;
      if (seat === 1) {
        await north.client.game(game.seq + 1);
        continue;
      }
      const actor = people.find((p) => players.indexOf(p) === seat);
      if (!actor) throw new Error(`Nobody in seat ${seat}`);
      const mine = await actor.client.game(game.seq);
      const moves = mine.legalMoves.filter((m) => m.type !== 'lookAtHand');
      await actor.client.ok({
        type: 'move',
        seq: game.seq,
        move: moves[randomInt(rng, moves.length)] as Move,
      });
      await Promise.all(people.map((p) => p.client.game(game.seq + 1)));
      made++;
    }
    const moves = await server.store.listMoves(table?.id as string);
    expect(moves.slice(2).some((m) => m.player === 1)).toBe(true);
  });
});

describe('which games have bots', () => {
  it('offers bots only for built-in games', async () => {
    const { client, code } = await hostedTable();
    const table = await server.store.getTableByInviteCode(code);
    const game = {
      id: 'custom',
      definitionId: 'custom',
      slug: 'my-game',
      name: 'My game',
      builtIn: false,
      version: 1,
      file: builtInGames.spades,
      fileHash: 'x',
    };
    if (!table) throw new Error('Missing table');
    expect(tableInfo(table, game, () => false).botsAllowed).toBe(false);
    expect(client.lastTable?.botsAllowed).toBe(true);
  });
});
