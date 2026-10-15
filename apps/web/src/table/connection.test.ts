import type { ServerMessage, TableInfo } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import { type SocketLike, TableConnection, TableError } from './connection';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | undefined;
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number): void {
    this.closedWith = code;
  }

  // Test helpers: what the server would do.
  serverOpens(): void {
    this.readyState = 1;
    this.emit('open');
  }
  serverSends(message: ServerMessage): void {
    this.emit('message', JSON.stringify(message));
  }
  drops(): void {
    this.readyState = 3;
    this.emit('close');
  }
  private emit(type: string, data?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener({ data });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const connection = new TableConnection({
    url: 'ws://test/api/tables/ABC/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    retryDelays: [100, 200],
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    clearTimer: () => undefined,
  });
  connection.start();
  const socket = () => sockets[sockets.length - 1] as FakeSocket;
  return { connection, sockets, timers, socket };
}

const table = { code: 'ABC', status: 'lobby' } as TableInfo;

describe('TableConnection', () => {
  it('closes for good, without reconnecting, when the table is deleted', () => {
    const { connection, socket, timers } = setup();
    socket().serverOpens();
    socket().serverSends({ type: 'deleted' });
    expect(connection.getSnapshot()).toMatchObject({ status: 'closed', deleted: true });
    socket().drops();
    expect(timers).toEqual([]);
  });

  it('connects and keeps the latest table info', () => {
    const { connection, socket } = setup();
    expect(connection.getSnapshot().status).toBe('connecting');
    socket().serverOpens();
    socket().serverSends({ type: 'table', table });
    expect(connection.getSnapshot()).toMatchObject({ status: 'open', table });
  });

  it('tells subscribers about every change, with a new snapshot object', () => {
    const { connection, socket } = setup();
    const seen: unknown[] = [];
    connection.subscribe(() => seen.push(connection.getSnapshot()));
    socket().serverOpens();
    socket().serverSends({ type: 'table', table });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('resolves a request when the server acknowledges it', async () => {
    const { connection, socket } = setup();
    socket().serverOpens();
    const sat = connection.send({ type: 'sit', seat: 2 });
    expect(socket().sent).toEqual([{ type: 'sit', seat: 2, id: 1 }]);
    socket().serverSends({ type: 'ack', id: 1 });
    await expect(sat).resolves.toBeUndefined();
  });

  it("rejects a request with the server's error", async () => {
    const { connection, socket } = setup();
    socket().serverOpens();
    const sat = connection.send({ type: 'sit', seat: 2 });
    socket().serverSends({ type: 'error', id: 1, code: 'SEAT_TAKEN', message: 'Taken' });
    await expect(sat).rejects.toEqual(new TableError('SEAT_TAKEN', 'Taken'));
    // Errors that answer a request aren't also shown as a general error.
    expect(connection.getSnapshot().error).toBeNull();
  });

  it('shows errors that answer no request', () => {
    const { connection, socket } = setup();
    socket().serverOpens();
    socket().serverSends({ type: 'error', id: null, code: 'SERVER_ERROR', message: 'Oops' });
    expect(connection.getSnapshot().error).toEqual({ code: 'SERVER_ERROR', message: 'Oops' });
    connection.dismissError();
    expect(connection.getSnapshot().error).toBeNull();
  });

  it('sends moves with the number of moves seen so far', () => {
    const { connection, socket } = setup();
    socket().serverOpens();
    socket().serverSends({
      type: 'game',
      seq: 7,
      view: {} as never,
      legalMoves: [],
      toAct: [0],
    });
    void connection.move({ player: 0, type: 'bid', value: 3 });
    expect(socket().sent[0]).toEqual({
      type: 'move',
      seq: 7,
      move: { player: 0, type: 'bid', value: 3 },
      id: 1,
    });
  });

  it('can start again after being closed', () => {
    const { connection, sockets, socket } = setup();
    connection.close();
    connection.start();
    expect(sockets).toHaveLength(2);
    socket().serverOpens();
    expect(connection.getSnapshot().status).toBe('open');
    // Starting an open connection does nothing.
    connection.start();
    expect(sockets).toHaveLength(2);
  });

  it('refuses to send while disconnected', async () => {
    const { connection } = setup();
    await expect(connection.send({ type: 'start' })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
  });

  it('reconnects with growing delays and fails requests that were in flight', async () => {
    const { connection, sockets, timers, socket } = setup();
    socket().serverOpens();
    const pending = connection.send({ type: 'start' });
    socket().drops();
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    expect(connection.getSnapshot().status).toBe('reconnecting');

    expect(timers.map((t) => t.ms)).toEqual([100]);
    timers[0]?.callback();
    expect(sockets).toHaveLength(2);
    socket().drops();
    timers[1]?.callback();
    socket().drops();
    // The last delay repeats.
    expect(timers.map((t) => t.ms)).toEqual([100, 200, 200]);

    timers[2]?.callback();
    socket().serverOpens();
    expect(connection.getSnapshot().status).toBe('open');
    socket().drops();
    // A successful connection resets the delays.
    expect(timers[3]?.ms).toBe(100);
  });

  it('stops for good when closed, ignoring the old socket', () => {
    const { connection, socket, timers } = setup();
    socket().serverOpens();
    const old = socket();
    connection.close();
    expect(old.closedWith).toBe(1000);
    old.drops();
    old.serverSends({ type: 'table', table });
    expect(timers).toHaveLength(0);
    expect(connection.getSnapshot()).toMatchObject({ status: 'closed', table: null });
  });

  it('remembers nudges and game-over messages', () => {
    const { connection, socket } = setup();
    socket().serverOpens();
    socket().serverSends({ type: 'nudged', by: 3 });
    socket().serverSends({ type: 'over', winners: [0, 2], scores: { teams: [], players: [] } });
    expect(connection.getSnapshot()).toMatchObject({ nudgedBy: 3, over: { winners: [0, 2] } });
    connection.dismissNudge();
    expect(connection.getSnapshot().nudgedBy).toBeNull();
  });
});
