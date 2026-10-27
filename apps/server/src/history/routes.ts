/**
 * Game history, from the results the server already saves.
 *
 *   GET /api/history?offset=0&game=spades&outcome=won
 *                               games I sat at that are over, newest first; `game` and
 *                               `outcome` (won, lost, early) are optional filters
 *   GET /api/history/games      the games in my history, most played first (filter chips)
 *   GET /api/stats              games played and won, per game
 *
 * A player a bot replaced mid-game no longer holds that seat, so the game
 * isn't in their history (see docs/decisions.md).
 */
import { createGame, goalOf, teamsFor } from '@card-table/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps';
import type { GameCatalog } from '../games/catalog';
import type { PastTable } from '../store/types';
import type { GameStats, PastGame, PastGameCount } from '../tables/protocol';

/** Games per page of history. */
export const HISTORY_PAGE = 20;

const historyQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  game: z.string().min(1).max(64).optional(),
  outcome: z.enum(['won', 'lost', 'early']).optional(),
});

export function historyRoutes(app: FastifyInstance, deps: Deps, catalog: GameCatalog): void {
  const { store } = deps;

  app.get('/api/history', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    const query = historyQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid page' });
    const { offset, game, outcome } = query.data;

    // One extra says whether there's another page.
    const tables = await store.listPastTables(
      user.id,
      { offset, limit: HISTORY_PAGE + 1 },
      { game, outcome },
    );
    const games = await Promise.all(
      tables.slice(0, HISTORY_PAGE).map((table) => pastGame(table, user.id)),
    );
    return { games, more: tables.length > HISTORY_PAGE };
  });

  app.get('/api/history/games', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    // Counted per version; every version of a game is one chip.
    const bySlug = new Map<string, PastGameCount>();
    for (const { gameVersionId, count } of await store.countPastTables(user.id)) {
      const { slug, name } = await catalog.version(gameVersionId);
      const entry = bySlug.get(slug) ?? { game: { slug, name }, count: 0 };
      entry.count += count;
      bySlug.set(slug, entry);
    }
    const games = [...bySlug.values()].sort(
      (a, b) => b.count - a.count || a.game.name.localeCompare(b.game.name),
    );
    return { games };
  });

  app.get('/api/stats', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    const bySlug = new Map<string, GameStats>();
    for (const played of await store.listPlayedResults(user.id)) {
      const { slug, name } = await catalog.version(played.gameVersionId);
      const stats = bySlug.get(slug) ?? { game: { slug, name }, played: 0, won: 0 };
      stats.played += 1;
      if (played.winners.includes(played.seat)) stats.won += 1;
      bySlug.set(slug, stats);
    }
    const stats = [...bySlug.values()].sort(
      (a, b) => b.played - a.played || a.game.name.localeCompare(b.game.name),
    );
    return { stats };
  });

  async function pastGame(table: PastTable, userId: string): Promise<PastGame> {
    const { slug, name, file } = await catalog.version(table.gameVersionId);
    const finished = table.status === 'finished' && table.result !== null;
    // Players on their own are each their own team, numbered by seat.
    const partners = teamsFor(file, table.playerCount);
    const seatTeams = Array.from(
      { length: table.playerCount },
      (_, seat) => partners?.findIndex((players) => players.includes(seat)) ?? seat,
    );
    // Which way wins can depend on the house rules, so ask the game (finished games only).
    const lowestWins =
      finished &&
      goalOf(createGame(file, table.options, table.playerCount, table.seed)).winner ===
        'lowestScore';
    return {
      code: table.inviteCode,
      game: { slug, name },
      status: finished ? 'finished' : 'abandoned',
      endedAt: table.endedAt?.toISOString() ?? null,
      seats: table.seats.map((s) => ({ seat: s.seat, displayName: s.displayName, bot: s.isBot })),
      you: table.seats.find((s) => s.userId === userId)?.seat ?? -1,
      seatTeams,
      winners: table.result?.winners ?? [],
      teams:
        table.result?.scores.teams.map((t) => ({
          team: t.team,
          players: t.players,
          score: t.score,
        })) ?? null,
      lowestWins,
    };
  }
}
