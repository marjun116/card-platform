/**
 * Tests every Store must pass. memory.test.ts runs them on MemoryStore;
 * prisma.test.ts runs them on Postgres when TEST_DATABASE_URL is set.
 */
import type { Move } from '@card-table/engine';
import { builtInGames } from '@card-table/games';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, type Store } from './types';

const spades = builtInGames.spades;
const minute = 60_000;

export function storeContract(makeStore: () => Promise<Store>): void {
  let store: Store;

  beforeEach(async () => {
    store = await makeStore();
  });

  async function newTable(code = 'ABC123') {
    const host = await store.createUser({ displayName: 'Host' });
    const game = await store.saveBuiltInGame({
      slug: 'spades',
      name: 'Spades',
      file: spades,
      fileHash: 'h1',
    });
    const table = await store.createTable({
      inviteCode: code,
      hostId: host.id,
      gameVersionId: game.id,
      options: { nil: true },
      playerCount: 4,
      seed: 'seed',
    });
    return { host, game, table };
  }

  describe('users', () => {
    it('creates guests and accounts, and finds them', async () => {
      const guest = await store.createUser({ displayName: 'Gus' });
      const account = await store.createUser({ displayName: 'Ann', email: 'ann@example.com' });
      expect(guest.email).toBeNull();
      expect(await store.getUser(guest.id)).toEqual(guest);
      expect(await store.getUserByEmail('ann@example.com')).toEqual(account);
      expect(await store.getUserByEmail('nobody@example.com')).toBeNull();
    });

    it('rejects a second user with the same email', async () => {
      await store.createUser({ displayName: 'A', email: 'a@example.com' });
      await expect(store.createUser({ displayName: 'B', email: 'a@example.com' })).rejects.toThrow(
        ConflictError,
      );
      const other = await store.createUser({ displayName: 'C' });
      await expect(store.updateUser(other.id, { email: 'a@example.com' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('merges a guest into an account, keeping seats that would clash', async () => {
      const { table } = await newTable();
      const { table: other } = await newTable('XYZ789');
      const guest = await store.createUser({ displayName: 'Gus' });
      const account = await store.createUser({ displayName: 'Ann', email: 'ann@example.com' });
      await store.takeSeat(table.id, 0, guest.id);
      await store.takeSeat(other.id, 0, guest.id);
      await store.takeSeat(other.id, 1, account.id);
      await store.createSession({
        id: 's',
        userId: guest.id,
        expiresAt: new Date(Date.now() + minute),
        lastSeenAt: new Date(),
      });

      await store.mergeUser(guest.id, account.id);

      expect((await store.getTable(table.id))?.seats[0]?.userId).toBe(account.id);
      const otherSeats = (await store.getTable(other.id))?.seats.map((s) => s.userId);
      expect(otherSeats).toEqual([guest.id, account.id]);
      expect(await store.getSession('s')).toBeNull();
    });
  });

  describe('sessions and login tokens', () => {
    it('creates, touches and deletes sessions', async () => {
      const user = await store.createUser({ displayName: 'U' });
      const expiresAt = new Date(Date.now() + minute);
      await store.createSession({ id: 'a', userId: user.id, expiresAt, lastSeenAt: new Date() });
      await store.createSession({ id: 'b', userId: user.id, expiresAt, lastSeenAt: new Date() });
      const later = new Date(Date.now() + 10 * minute);
      await store.touchSession('a', new Date(), later);
      expect((await store.getSession('a'))?.expiresAt).toEqual(later);
      await store.deleteSession('a');
      expect(await store.getSession('a')).toBeNull();
      await store.deleteUserSessions(user.id);
      expect(await store.getSession('b')).toBeNull();
    });

    it('lets a login token be used once, before it expires', async () => {
      const now = new Date();
      await store.createLoginToken({
        tokenHash: 't1',
        email: 'a@example.com',
        expiresAt: new Date(now.getTime() + minute),
        usedAt: null,
      });
      await store.createLoginToken({
        tokenHash: 't2',
        email: 'a@example.com',
        expiresAt: new Date(now.getTime() - 1),
        usedAt: null,
      });
      expect((await store.consumeLoginToken('t1', now))?.email).toBe('a@example.com');
      expect(await store.consumeLoginToken('t1', now)).toBeNull();
      expect(await store.consumeLoginToken('t2', now)).toBeNull();
      expect(await store.consumeLoginToken('nope', now)).toBeNull();
    });
  });

  describe('games', () => {
    it('adds a new version only when a built-in file changes', async () => {
      const v1 = await store.saveBuiltInGame({
        slug: 'spades',
        name: 'Spades',
        file: spades,
        fileHash: 'h1',
      });
      const again = await store.saveBuiltInGame({
        slug: 'spades',
        name: 'Spades',
        file: spades,
        fileHash: 'h1',
      });
      const v2 = await store.saveBuiltInGame({
        slug: 'spades',
        name: 'Spades',
        file: spades,
        fileHash: 'h2',
      });
      expect(again.id).toBe(v1.id);
      expect(v2.version).toBe(2);
      expect(v2.definitionId).toBe(v1.definitionId);
      expect((await store.getGameVersion(v1.id))?.file).toEqual(spades);
    });
  });

  describe('tables', () => {
    it('creates tables and finds them by id and invite code', async () => {
      const { host, table } = await newTable();
      expect(table.status).toBe('lobby');
      expect(table.options).toEqual({ nil: true });
      expect((await store.getTableByInviteCode('ABC123'))?.id).toBe(table.id);
      expect(await store.getTableByInviteCode('nope')).toBeNull();
      expect((await store.listOpenTables(host.id)).map((t) => t.id)).toEqual([table.id]);
      const { hostId, gameVersionId, options, playerCount, seed } = table;
      await expect(
        store.createTable({
          inviteCode: 'ABC123',
          hostId,
          gameVersionId,
          options,
          playerCount,
          seed,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('seats each user once and each seat once', async () => {
      const { table } = await newTable();
      const a = await store.createUser({ displayName: 'A' });
      const b = await store.createUser({ displayName: 'B' });
      await store.takeSeat(table.id, 2, a.id);
      await expect(store.takeSeat(table.id, 2, b.id)).rejects.toThrow(ConflictError);
      await expect(store.takeSeat(table.id, 3, a.id)).rejects.toThrow(ConflictError);
      await store.takeSeat(table.id, 0, b.id);
      const seats = (await store.getTable(table.id))?.seats;
      expect(seats?.map((s) => [s.seat, s.displayName])).toEqual([
        [0, 'B'],
        [2, 'A'],
      ]);
      expect((await store.listOpenTables(a.id)).length).toBe(1);
      await store.leaveSeat(table.id, 2);
      expect((await store.getTable(table.id))?.seats.length).toBe(1);
    });

    it('records moves in order and refuses a reused move number', async () => {
      const { table } = await newTable();
      const m0: Move = { player: 1, type: 'bid', value: 3 };
      const m1: Move = { player: 2, type: 'bid', value: 'nil' };
      const since = new Date();
      await store.recordMove(table.id, 0, m0, { toAct: [2], turnSince: since });
      await expect(
        store.recordMove(table.id, 0, m1, { toAct: [3], turnSince: since }),
      ).rejects.toThrow(ConflictError);
      await store.recordMove(table.id, 1, m1, { toAct: [3], turnSince: since });
      expect(await store.listMoves(table.id)).toEqual([m0, m1]);
      const saved = await store.getTable(table.id);
      expect(saved?.toAct).toEqual([3]);
      expect(saved?.turnSince).toEqual(since);
    });

    it('finishes a table with its result in the same write', async () => {
      const { host, table } = await newTable();
      const endedAt = new Date();
      const scores = { teams: [], players: [] };
      await store.recordMove(
        table.id,
        0,
        { player: 0, type: 'endTurn' },
        { toAct: [], turnSince: null, finished: { endedAt, result: { winners: [0, 2], scores } } },
      );
      const saved = await store.getTable(table.id);
      expect(saved?.status).toBe('finished');
      expect(saved?.endedAt).toEqual(endedAt);
      expect(await store.getResult(table.id)).toEqual({ winners: [0, 2], scores });
      expect(await store.listOpenTables(host.id)).toEqual([]);
    });

    it('finds turns left idle, once per turn', async () => {
      const { table } = await newTable();
      const a = await store.createUser({ displayName: 'A' });
      const b = await store.createUser({ displayName: 'B' });
      await store.takeSeat(table.id, 0, a.id);
      await store.takeSeat(table.id, 1, b.id);
      const turnSince = new Date(Date.now() - 60 * minute);
      await store.updateTable(table.id, { status: 'playing', toAct: [1], turnSince });

      expect(await store.findIdleTurns(new Date(Date.now() - 120 * minute))).toEqual([]);
      const idle = await store.findIdleTurns(new Date());
      expect(idle).toEqual([{ tableId: table.id, seat: 1, userId: b.id }]);

      await store.setNudged(table.id, 1, new Date());
      expect(await store.findIdleTurns(new Date())).toEqual([]);

      await store.updateTable(table.id, { status: 'paused' });
      await store.setNudged(table.id, 1, new Date(0));
      expect(await store.findIdleTurns(new Date())).toEqual([]);
    });
  });
}
