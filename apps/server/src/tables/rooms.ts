/**
 * Keeps one TableRoom in memory per table that someone has open, and drops
 * it when the last person leaves. Also runs the idle-turn nudges.
 */
import type { WebSocket } from '@fastify/websocket';
import type { Deps } from '../deps';
import type { GameCatalog } from '../games/catalog';
import type { Table, User } from '../store/types';
import { startRematch, TableRoom } from './room';

export class Rooms {
  private loading = new Map<string, Promise<TableRoom>>();
  /** Rooms that have finished loading, for quick "who's connected" checks. */
  private ready = new Map<string, TableRoom>();

  constructor(
    private readonly deps: Deps,
    private readonly catalog: GameCatalog,
  ) {}

  /** Connects a socket to its table's room, loading the room if nobody has it open. */
  async join(table: Table, socket: WebSocket, user: User): Promise<TableRoom> {
    for (;;) {
      const room = await this.open(table);
      // connect() fails only if the room closed while we were waiting; try a fresh one.
      if (await room.connect(socket, user)) return room;
    }
  }

  async leave(room: TableRoom, socket: WebSocket): Promise<void> {
    await room.disconnect(socket);
    if (await room.closeIfEmpty()) {
      // Only forget it if it's still the current room for this table.
      if (this.ready.get(room.tableId) === room) {
        this.ready.delete(room.tableId);
        this.loading.delete(room.tableId);
      }
    }
  }

  /** Deletes a table, through its room if someone has it open (see TableRoom.delete). */
  async delete(table: Table): Promise<void> {
    const loading = this.loading.get(table.id);
    if (!loading) {
      await this.deps.store.deleteTable(table.id);
      return;
    }
    const room = await loading;
    this.loading.delete(table.id);
    this.ready.delete(table.id);
    await room.delete();
  }

  /**
   * Starts (or joins) a finished table's rematch and gives its code: through the
   * table's room if someone has it open, so they're told, or else straight away.
   * Throws RoomError if the game isn't finished or the user wasn't seated.
   */
  async rematch(table: Table, user: User): Promise<string> {
    const loading = this.loading.get(table.id);
    if (loading) return (await loading).rematchFor(user);
    return (await startRematch(this.deps, table, user)).code;
  }

  /** Whether the user has this table open right now. */
  isConnected(tableId: string, userId: string): boolean {
    return this.ready.get(tableId)?.isConnected(userId) ?? false;
  }

  private open(table: Table): Promise<TableRoom> {
    let room = this.loading.get(table.id);
    if (!room) {
      room = this.catalog
        .version(table.gameVersionId)
        .then((game) => TableRoom.load(this.deps, table, game));
      this.loading.set(table.id, room);
      room.then(
        (r) => this.ready.set(table.id, r),
        () => this.loading.delete(table.id),
      );
    }
    return room;
  }

  /**
   * Notifies players whose turn has lasted longer than the limit and who
   * don't have the table open. Each turn is nudged at most once.
   */
  async sweepIdleTurns(): Promise<void> {
    const { store, notifier, config, now } = this.deps;
    const time = now();
    const idle = await store.findIdleTurns(new Date(time.getTime() - config.idleNudgeAfterMs));
    for (const turn of idle) {
      if (this.isConnected(turn.tableId, turn.userId)) continue;
      await store.setNudged(turn.tableId, turn.seat, time);
      await notifier.notify({ ...turn, reason: 'idle' });
    }
  }
}
