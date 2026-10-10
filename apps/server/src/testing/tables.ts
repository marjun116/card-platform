/** Helpers for tests that play at tables over real WebSockets. */
import type { Move, OptionValue } from '@card-table/engine';
import { randomInt, seedRng } from '@card-table/engine/testing';
import type { AddressInfo } from 'node:net';
import { TestClient } from './client';
import { guest, type TestServer, withSession } from './index';

export interface Player {
  name: string;
  token: string;
  userId: string;
  client: TestClient;
}

/** Starts the server on a free port and returns its base URL. */
export async function listen(server: TestServer): Promise<string> {
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = server.app.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Creates a table as the user with this token and returns its invite code. */
export async function createTable(
  server: TestServer,
  token: string,
  body: { game: string; options?: Record<string, OptionValue>; playerCount?: number } = {
    game: 'spades',
  },
): Promise<string> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/tables',
    body,
    headers: withSession(token),
  });
  if (res.statusCode !== 201) throw new Error(`Couldn't create table: ${res.body}`);
  return res.json<{ table: { code: string } }>().table.code;
}

/**
 * Four guests at a spades table (or another four-player game): the first is
 * the host, each sits in the seat matching their index. Starts the game
 * unless `start` is false.
 */
export async function spadesTable(
  server: TestServer,
  baseUrl: string,
  {
    options = {},
    start = true,
    game = 'spades',
  }: { options?: Record<string, OptionValue>; start?: boolean; game?: string } = {},
): Promise<{ code: string; players: Player[] }> {
  const names = ['North', 'East', 'South', 'West'];
  const guests = await Promise.all(names.map((name) => guest(server.app, name)));
  const code = await createTable(server, (guests[0] as { token: string }).token, {
    game,
    options,
  });
  const players: Player[] = [];
  for (const [seat, g] of guests.entries()) {
    const name = names[seat] as string;
    const client = await TestClient.connect(baseUrl, code, g.token, name);
    await client.ok({ type: 'sit', seat });
    players.push({ name, ...g, client });
  }
  if (start) {
    await (players[0] as Player).client.ok({ type: 'start' });
    await Promise.all(players.map((p) => p.client.game(0)));
  }
  return { code, players };
}

/**
 * Plays random legal moves until the game ends (or `maxMoves` moves). Each
 * move is made by the player whose turn it is, using only what that player's
 * client was sent; it then waits until every player has seen the result.
 */
export async function playRandomly(
  players: Player[],
  seed: string,
  { maxMoves = Infinity }: { maxMoves?: number } = {},
): Promise<number> {
  const rng = seedRng(seed);
  let made = 0;
  for (;;) {
    const view = players[0]?.client.lastGame;
    if (!view || view.toAct.length === 0 || made >= maxMoves) return made;
    const actor = players[view.toAct[0] as number] as Player;
    const game = actor.client.lastGame;
    if (game?.seq !== view.seq) throw new Error(`${actor.name} is behind`);
    // Look at your hand only when there's nothing else to do (a blind player's turn to play).
    const others = game.legalMoves.filter((m) => m.type !== 'lookAtHand');
    const choices = others.length > 0 ? others : game.legalMoves;
    const move = choices[randomInt(rng, choices.length)] as Move;
    await actor.client.ok({ type: 'move', seq: game.seq, move });
    made++;
    await Promise.all(players.map((p) => p.client.game(game.seq + 1)));
  }
}
