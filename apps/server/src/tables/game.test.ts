/**
 * Full games of spades over real WebSocket connections: four guests, each
 * with their own socket, playing random legal moves until someone wins.
 * Also covers reconnecting and resuming after a server restart.
 */
import { getScores, isGameOver, type Move, replay } from '@card-table/engine';
import { builtInGames } from '@card-table/games';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { testServer, type TestServer } from '../testing';
import { TestClient } from '../testing/client';
import { listen, playRandomly, spadesTable } from '../testing/tables';

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await server.app.close();
});

describe('a full game over WebSockets', () => {
  it.each(['full-game-1', 'full-game-2', 'full-game-3'])(
    'plays 4-player spades to the end, saving every move (%s)',
    async (seed) => {
      server = await testServer();
      const baseUrl = await listen(server);
      const { code, players } = await spadesTable(server, baseUrl);
      clients.push(...players.map((p) => p.client));

      const moves = await playRandomly(players, seed);
      // A round of spades is 4 bids and 52 cards.
      expect(moves).toBeGreaterThanOrEqual(56);
      expect(moves % 56).toBe(0);

      // Everyone was told the game is over, with the same result.
      const overs = await Promise.all(
        players.map((p) => p.client.waitFor((m) => m.type === 'over', 'game over')),
      );
      for (const over of overs) expect(over).toEqual(overs[0]);

      // The saved table matches a replay of the saved moves.
      const table = await server.store.getTableByInviteCode(code);
      if (!table) throw new Error('Table missing');
      expect(table.status).toBe('finished');
      const saved = await server.store.listMoves(table.id);
      expect(saved).toHaveLength(moves);
      const final = replay(builtInGames.spades, table.options, 4, table.seed, saved);
      expect(isGameOver(final)).toBe(true);
      expect(await server.store.getResult(table.id)).toEqual({
        winners: final.winners,
        scores: getScores(final),
      });
      expect(overs[0]).toMatchObject({ winners: final.winners });

      // Each player's last view is the engine's view for their seat.
      for (const [seat, p] of players.entries()) {
        expect(p.client.lastGame?.view.you).toBe(seat);
        expect(p.client.lastGame?.view.status).toBe('over');
        expect(p.client.lastGame?.legalMoves).toEqual([]);
      }
    },
  );
});

describe('a long game', () => {
  it('keeps up over hundreds of moves', async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { players } = await spadesTable(server, baseUrl, {
      options: { mercyRule: false, targetScore: 1000 },
    });
    clients.push(...players.map((p) => p.client));
    expect(await playRandomly(players, 'long', { maxMoves: 400 })).toBe(400);
    for (const p of players) expect(p.client.lastGame?.seq).toBe(400);
  });
});

describe('reconnecting', () => {
  it('sends a returning player the current table and their view', async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { code, players } = await spadesTable(server, baseUrl);
    clients.push(...players.map((p) => p.client));
    await playRandomly(players, 'reconnect', { maxMoves: 10 });

    const east = players[1];
    if (!east) throw new Error('No East');
    const before = east.client.lastGame;
    await east.client.close();
    clients.splice(clients.indexOf(east.client), 1);
    await players[0]?.client.table((t) => t.seats[1]?.connected === false, 'East offline');

    // East comes back and gets exactly the view they had.
    const again = await TestClient.connect(baseUrl, code, east.token, 'East again');
    clients.push(again);
    east.client = again;
    const view = await again.game(before?.seq ?? -1);
    expect(view).toEqual(before);
    expect(again.lastTable?.seats[1]?.connected).toBe(true);

    // And play carries on.
    await playRandomly(players, 'reconnect-2', { maxMoves: 10 });
    expect(again.lastGame?.seq).toBe((before?.seq ?? 0) + 10);
  });

  it('resumes a table after the server restarts', async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { code, players } = await spadesTable(server, baseUrl);
    clients.push(...players.map((p) => p.client));
    await playRandomly(players, 'restart', { maxMoves: 25 });
    const views = players.map((p) => p.client.lastGame);
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await server.app.close();

    // A new server process, same database.
    const app = await buildApp({ store: server.store, now: () => new Date() });
    server = { ...server, app };
    const newUrl = await listen(server);
    for (const [seat, p] of players.entries()) {
      p.client = await TestClient.connect(newUrl, code, p.token, p.name);
      clients.push(p.client);
      expect(await p.client.game(25)).toEqual(views[seat]);
    }
    await playRandomly(players, 'restart-2', { maxMoves: 10 });
    expect(players[0]?.client.lastGame?.seq).toBe(35);
  });
});

describe('playing for another seat', () => {
  it("lets bridge's declarer play the dummy's cards, and nobody else", async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { players } = await spadesTable(server, baseUrl, { game: 'bridge' });
    clients.push(...players.map((p) => p.client));
    const client = (seat: number) => (players[seat] as (typeof players)[number]).client;
    const send = async (seat: number, move: Move) => {
      const seq = client(seat).lastGame?.seq ?? 0;
      await client(seat).ok({ type: 'move', seq, move });
      await Promise.all(players.map((p) => p.client.game(seq + 1)));
    };

    // The dealer bids 1♣ and everyone else passes: the dealer declares.
    const dealer = client(0).lastGame?.view.dealer as number;
    await send(dealer, { player: dealer, type: 'bid', value: 11 });
    for (let i = 1; i < 4; i++) await send((dealer + i) % 4, { player: 0, type: 'passBid' });
    const dummy = (dealer + 2) % 4;
    const leader = (dealer + 1) % 4;
    const lead = client(leader).lastGame?.legalMoves[0] as Move;
    await send(leader, lead);

    // The dummy's turn: its hand is face up for everyone; the declarer is told its moves.
    const game = client(dealer).lastGame;
    expect(game?.toAct).toEqual([dealer]);
    expect(game?.view.control).toEqual({ seat: dummy, by: dealer });
    expect(client(leader).lastGame?.view.zones[`hand@${dummy}`]).toMatchObject({ kind: 'cards' });
    expect(client(dummy).lastGame?.legalMoves).toEqual([]);
    const forDummy = game?.legalMoves.find((m) => m.player === dummy) as Move;
    expect(forDummy).toMatchObject({ by: dealer, type: 'playToTrick' });

    // The dummy can't play its own card, and another player can't play it either.
    const seq = game?.seq as number;
    const { by: _by, ...own } = forDummy;
    expect(
      await client(dummy).request({ type: 'move', seq, move: { ...own, player: dummy } }),
    ).toMatchObject({ type: 'error', code: 'ILLEGAL_MOVE' });
    expect(
      await client(leader).request({ type: 'move', seq, move: { ...forDummy, by: leader } }),
    ).toMatchObject({ type: 'error', code: 'ILLEGAL_MOVE' });

    // The declarer can, whatever `by` the message claims; the log records who chose it.
    await send(dealer, { ...forDummy, by: 3 });
    const log = client(leader).lastGame?.view.log;
    expect(log?.at(-1)).toMatchObject({ player: dummy, by: dealer });
  });
});
